# UX State Model

## Application states

```text
booting -> ready
booting -> disconnected
disconnected -> reconnecting -> ready
reconnecting -> fatal
```

## Command states

```text
idle -> pending -> succeeded
pending -> rejected | duplicate | transport_failed | timeout
```

Every pending command disables conflicting controls, exposes `aria-busy` and
uses one idempotency key. Retry reuses the same key. A fast response remains
visibly pending for the minimum UX duration, without delaying the authoritative
server commit.

## Content states

```text
loading | available | empty | stale | unavailable
```

Transport failure, game rejection and LLM narrative timeout are distinct. A
narrative timeout must not replay or duplicate a committed player command.

## Player-facing mapping

| Technical state | Player message | Available action |
|---|---|---|
| pending | «Мир отвечает…» | No conflicting controls |
| transport_failed | «Связь с миром прервалась» | Retry same intention/key |
| rejected | Authoritative game explanation | Choose another intention |
| timeout | «Ответ задерживается» | Wait or safely recover |
| stale | «Показана последняя известная запись» | Reconnect |
| empty journal | «История ещё не началась» | Return to game |
