#!/usr/bin/env python3
"""Read-only Skald browser smoke for the golden-world UI contract.

Run against an ephemeral server with ``SKALD_PORT=3010 npm run start:server``
or pass ``--base-url``. Pass ``--world-url`` only when a seeded browser session
and lease already exist; the smoke never submits a command or creates a world.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from urllib.parse import unquote, urlsplit
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=os.environ.get("SKALD_BROWSER_BASE_URL", "http://127.0.0.1:3000"))
    parser.add_argument("--world-url", default=os.environ.get("SKALD_BROWSER_WORLD_URL"))
    parser.add_argument(
        "--lease-file",
        default=os.environ.get("SKALD_BROWSER_LEASE_FILE"),
        help="JSON file with a prepared browser-session lease for --world-url",
    )
    parser.add_argument("--fixture", default="docs/acceptance/golden-world.json")
    parser.add_argument("--artifacts", default=os.environ.get("SKALD_BROWSER_ARTIFACTS"))
    return parser.parse_args()


def fail(message: str) -> None:
    raise AssertionError(message)


class SmokeConfigurationError(Exception):
    """The requested smoke needs prepared external test state."""


def block(message: str) -> None:
    raise SmokeConfigurationError(message)


def assert_visible(page, selector: str) -> None:
    locator = page.locator(selector).first
    if not locator.is_visible():
        fail(f"expected visible selector: {selector}")


def world_id_from_url(world_url: str) -> str:
    match = re.search(r"(?:#)?/world/([^/?#]+)", world_url)
    if not match:
        block("--world-url must contain a /world/:id route")
    return unquote(match.group(1))


def read_lease(path_value: str, expected_world_id: str) -> tuple[str, str]:
    lease_path = Path(path_value)
    try:
        lease = json.loads(lease_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        block(f"could not read --lease-file: {exc}")
    if not isinstance(lease, dict):
        block("--lease-file must contain a JSON object")
    if lease.get("schemaVersion") != 1:
        block("browser lease schemaVersion must be 1")
    if lease.get("worldId") != expected_world_id:
        block("browser lease worldId does not match --world-url")
    for field in ("acknowledgedWorldTime", "acknowledgedEventNumber"):
        value = lease.get(field)
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            block(f"browser lease {field} must be a non-negative integer")
    key = f"skald:presence:lease:1:{expected_world_id}"
    return key, json.dumps(lease, ensure_ascii=False, separators=(",", ":"))


def main() -> int:
    args = parse_args()
    fixture_path = Path(args.fixture)
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    console_errors: list[str] = []
    console_warnings: list[str] = []
    page_errors: list[str] = []
    screenshots: list[str] = []
    checked_viewports = [{"width": 1440, "height": 900}]

    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        print(f"BLOCKED: Playwright is not installed in this Python environment: {exc}", file=sys.stderr)
        return 2

    def on_console(message) -> None:
        if message.type == "error":
            console_errors.append(message.text)
        elif message.type == "warning":
            console_warnings.append(message.text)

    def on_page_error(error) -> None:
        page_errors.append(str(error))

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1440, "height": 900})
            if args.world_url:
                if not args.lease_file:
                    block("--world-url requires --lease-file so the prepared session lease is explicit")
                base_origin = urlsplit(args.base_url)
                world_origin = urlsplit(args.world_url)
                if (base_origin.scheme, base_origin.netloc) != (world_origin.scheme, world_origin.netloc):
                    block("--base-url and --world-url must use the same origin for sessionStorage seeding")
                lease_key, lease_value = read_lease(args.lease_file, world_id_from_url(args.world_url))
                context.add_init_script(
                    script=(
                        "sessionStorage.setItem("
                        + json.dumps(lease_key)
                        + ","
                        + json.dumps(lease_value)
                        + ");"
                    )
                )
            page = context.new_page()
            page.on("console", on_console)
            page.on("pageerror", on_page_error)

            page.goto(args.base_url.rstrip("/"), wait_until="networkidle")
            assert_visible(page, "#menu-container")
            page.get_by_role("button", name="Начать новую историю").click()
            page.wait_for_selector("#new-game-container")
            assert_visible(page, "#new-game-container")
            if args.artifacts:
                artifact_dir = Path(args.artifacts)
                artifact_dir.mkdir(parents=True, exist_ok=True)
                menu_path = artifact_dir / "menu.png"
                page.goto(args.base_url.rstrip("/"), wait_until="networkidle")
                page.screenshot(path=str(menu_path), full_page=True)
                screenshots.append(str(menu_path))
                page.get_by_role("button", name="Начать новую историю").click()
                page.wait_for_selector("#new-game-container")
                new_game_path = artifact_dir / "new-game.png"
                page.screenshot(path=str(new_game_path), full_page=True)
                screenshots.append(str(new_game_path))

            if args.world_url:
                page.goto(args.world_url, wait_until="networkidle")
                for selector in fixture["requiredUiSelectors"]:
                    assert_visible(page, selector)
                if not page.locator("#command-form[novalidate]").count():
                    fail("composer form must use novalidate")
                if page.locator("#command-form[aria-busy]").count() != 1:
                    fail("composer form must expose aria-busy")
                if page.locator(".dpad, .action-chip, [data-action-chip], [data-direction]").count():
                    fail("directional/action controls must not be present")
                if page.evaluate("document.body.scrollWidth > window.innerWidth + 1"):
                    fail("horizontal overflow detected at 1440x900")

                body_text = page.locator("body").inner_text()
                for pattern in fixture["forbiddenTextPatterns"]:
                    if re.search(re.escape(pattern), body_text, re.IGNORECASE):
                        fail(f"forbidden internal text visible: {pattern}")

                for selector in ("#send-btn", "#open-map-btn", "#open-knowledge-btn"):
                    box = page.locator(selector).bounding_box()
                    if not box or box["width"] < 44 or box["height"] < 44:
                        fail(f"important control is smaller than 44x44: {selector}")
                page.locator("#command-input").focus()
                if page.evaluate("document.activeElement?.id") != "command-input":
                    fail("composer input did not receive focus")

                page.get_by_role("button", name="Карта").click()
                assert_visible(page, "#context-map")
                page.keyboard.press("Escape")
                if page.locator("#context-overlay").is_visible():
                    fail("player-space overlay did not close on Escape")
                if page.evaluate("document.activeElement?.id") != "open-map-btn":
                    fail("overlay did not restore focus to its opener")
                page.get_by_role("button", name="Карта").click()
                assert_visible(page, "#context-map")
                page.locator("#context-tab-knowledge").click()
                assert_visible(page, "#context-knowledge")
                page.reload(wait_until="networkidle")
                if page.evaluate("document.body.scrollWidth > window.innerWidth + 1"):
                    fail("horizontal overflow detected after reload")
                page.set_viewport_size({"width": 390, "height": 844})
                checked_viewports.append({"width": 390, "height": 844})
                page.reload(wait_until="networkidle")
                for selector in fixture["requiredUiSelectors"]:
                    assert_visible(page, selector)
                if page.evaluate("document.body.scrollWidth > window.innerWidth + 1"):
                    fail("horizontal overflow detected at 390x844")
                if args.artifacts:
                    world_path = Path(args.artifacts) / "world.png"
                    page.screenshot(path=str(world_path), full_page=True)
                    screenshots.append(str(world_path))

            browser.close()
    except Exception as exc:  # noqa: BLE001 - smoke report must preserve browser evidence.
        error_text = str(exc)
        blocked = isinstance(exc, SmokeConfigurationError) or any(
            marker in error_text for marker in ("ERR_CONNECTION_REFUSED", "Connection refused", "net::ERR_")
        )
        result = {
            "status": "BLOCKED" if blocked else "FAIL",
            "baseUrl": args.base_url,
            "worldUrl": args.world_url,
            "consoleErrors": console_errors,
            "consoleWarnings": console_warnings,
            "pageErrors": page_errors,
            "screenshots": screenshots,
            "error": error_text,
        }
        if args.artifacts:
            artifact_dir = Path(args.artifacts)
            artifact_dir.mkdir(parents=True, exist_ok=True)
            (artifact_dir / "browser-smoke.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2 if blocked else 1

    result = {
        "status": "PASS" if args.world_url else "BLOCKED",
        "baseUrl": args.base_url,
        "worldUrl": args.world_url,
        "viewports": checked_viewports,
        "consoleErrors": console_errors,
        "consoleWarnings": console_warnings,
        "pageErrors": page_errors,
        "screenshots": screenshots,
        "gameplayClicks": 0,
        "fixture": str(fixture_path),
    }
    if not args.world_url:
        result["blockedReason"] = "menu smoke completed, but --world-url was not supplied; the release UI contract was not exercised"
    if console_errors or page_errors:
        result["status"] = "FAIL"
    if args.artifacts:
        artifact_dir = Path(args.artifacts)
        artifact_dir.mkdir(parents=True, exist_ok=True)
        (artifact_dir / "browser-smoke.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result["status"] == "FAIL":
        return 1
    return 2 if result["status"] == "BLOCKED" else 0


if __name__ == "__main__":
    raise SystemExit(main())
