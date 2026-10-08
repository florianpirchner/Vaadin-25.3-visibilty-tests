# Vaadin 25.3 `setVisible()` on containers — repro and findings

A reported regression: after upgrading from Vaadin 25.2.3 to 25.3.x, containers created with
`setVisible(false)` show up anyway, and every server roundtrip flips them — wrong, right, wrong,
right. Selecting one of them in the Chrome DevTools Elements panel makes it (wrongly) visible again.
A ChatGPT conversation reasoned about this without running anything. This project runs it.

The raw output of the run below is in [`results-2026-10-08.tsv`](results-2026-10-08.tsv).

## Stack

Spring Boot 4.1.1 · Java 25 · Vaadin 25.2.3 / 25.3.0 / 25.3.1 (switched with `-Dvaadin.version`) ·
Playwright 1.56.1 (Chromium). The app is built in production mode (`-Pproduction`): a plain jar
without the frontend bundle refuses to start (`'vaadin-dev-server' not found`).

## Run

```bash
./run-matrix.sh                 # all three versions
./run-matrix.sh 25.3.1          # one version
# or by hand:
mvn -Pproduction package && java -jar target/app.jar     # http://localhost:8080
```

`run-matrix.sh` builds, starts and tests each version in turn and writes `results.tsv`
(one line per version and case, the verdict after the initial render and after each of four roundtrips).

## What the page does

[`VisibilityView`](src/main/java/com/example/visibility/VisibilityView.java) puts four containers into one
parent `VerticalLayout`; panel 1 stays visible, panels 2–4 are made invisible. Query parameters choose
the variant:

| Parameter | Values | Meaning |
|---|---|---|
| `kind` | `div` · `vertical` · `horizontal` · `form` | container type |
| `when` | `before` · `after` · `delayed` | `setVisible(false)` before `add()`, after `add()`, or on the first roundtrip once the panels were rendered visible |
| `mode` | `static` · `rebuild` · `reattach` · `resend` | what each roundtrip does: nothing; `removeAll()` + four new panels; `removeAll()` + re-add the same instances; `setVisible(true)` then `setVisible(false)` |
| `style` | `none` · `class` · `inline` | give the panels `display:flex` through a CSS class or an inline style |

A roundtrip is a button click or a keystroke in an `EAGER` text field. Whatever the variant, the
server ends every roundtrip with panel 1 visible and panels 2–4 invisible, and
[`visibility.spec.ts`](e2e/visibility.spec.ts) asserts after the initial render and after each of four
roundtrips that the DOM agrees: `[hidden]` present **and** the element not rendered
(`getClientRects()` empty), so a CSS override would be caught as well as a missing attribute.

## Result (2026-10-08)

**96 / 96 green — 32 cases × 3 versions. The alternating behaviour does not reproduce.**

| Vaadin | Flow client | Cases | Result |
|---|---|---|---|
| 25.2.3 | 25.2.4 (GWT) | 32 | all `ok` at every step |
| 25.3.0 | 25.3.0 (TypeScript) | 32 | all `ok` at every step |
| 25.3.1 | 25.3.2 (TypeScript) | 32 | all `ok` at every step |

So `setVisible()` on containers is not broken in 25.3.x as such. Whatever produces the reported
behaviour depends on something the reporting application has and this page does not.

## The conversation's claims, checked

| Claim | Verdict | Evidence |
|---|---|---|
| The Flow client was ported from GWT to TypeScript between 25.2.3 and 25.3.0 | **True** | `flow-client-25.2.4.jar` ships one compiled `FlowClient.js`; `flow-client-25.3.x.jar` ships per-module JS compiled from TypeScript, each function annotated "Mirrors …" its Java original |
| `bindVisibility` / `updateVisibility` / `setElementInvisible` / `restoreInitialHiddenAttribute` / `needsRebind` drive visibility | **True** | `META-INF/frontend/internal/client/flow/binding/SimpleElementBindingStrategy.js` in the 25.3.x jar |
| A port error in that path is a plausible cause | **Not supported** | Compared line by line with `SimpleElementBindingStrategy.java` from `flow-client-25.2.4-sources.jar`: same branches, same order. `MapProperty` moved from `Objects.equals` to `===`, which is identical for the boolean visibility values |
| `SimpleElementBindingStrategy` unchanged from 25.3.0 to 25.3.1; `Flow.ts` / `BrowserHelpers.ts` changed | **True** | Jar diff of flow-client 25.3.0 vs 25.3.2: the binding file is byte-identical; `Flow.js`, `FlowClient.js` changed, `BrowserHelpers.js` is new |
| The `hidden` attribute may be set but overridden by CSS such as `display: flex` | **False for a standard app** | Vaadin injects `[hidden] { display: none !important; }`; the `style=class` / `style=inline` cases confirm `display:flex` does not win. A panel that *starts* invisible is not even bound, so its classes and styles never reach the DOM |
| The minimal test from the conversation (toggle button + `beforeClientResponse`) isolates the bug | **No** | That exact setup is the `static` case here, green on all versions |
| GitHub issues #8100, #13717, #17650 are related | **Not verified** | `github.com` is not reachable from the environment this was run in |

One behaviour worth knowing when debugging this in DevTools: a component that is invisible when it is
first sent to the browser arrives as an **empty, unbound element** — `<div hidden="true"></div>`, no
`id`, no class, no children. Its attributes and children are bound only when it becomes visible
(`needsRebind`). A query by `id` finds nothing, and a selector that relies on a class misses it.

## What would narrow it down

The reported pattern — wrong on the initial render, then flipping on every roundtrip, and changed by
merely *selecting* the element in DevTools — needs an ingredient this page lacks. Candidates, each
cheap to add here as one more `mode` or `style`:

- the containers are not plain `Div`/layouts but custom components, Lit templates, or
  `@Tag` / `Component` subclasses with their own client-side code;
- visibility is bound (`bindVisible`, Binder, signals) rather than set imperatively;
- the parent is itself re-rendered, virtualised (`Grid`, `VirtualList`) or lives in a shadow root —
  only the shadow-root path writes `style.display` in `setElementInvisible`;
- application CSS that redefines `[hidden]`, uses `:has()`, container queries or
  `content-visibility`, or a theme other than the default;
- `@Push`, or something that runs `executeJs` on these elements.

The DevTools detail points away from Flow's state handling: selecting a node in the Elements panel
does not touch Flow's state tree, but it does force a style recalculation. An element whose
appearance changes on selection suggests stale style invalidation in the browser, which an
alternating attribute write (or an `executeJs` that toggles something) could trigger.
