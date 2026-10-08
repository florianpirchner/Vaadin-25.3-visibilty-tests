import { expect, test, type Page } from "@playwright/test";
import { appendFileSync } from "node:fs";

/**
 * Four containers in one parent, panels 2-4 setVisible(false) on the server.
 * Nothing changes visibility after construction, so after EVERY roundtrip the
 * DOM must show: panel-1 visible, panel-2..4 with [hidden] and not rendered.
 */

const KINDS = ["div", "vertical", "horizontal", "form"] as const;
const WHENS = ["before", "after"] as const;
type When = (typeof WHENS)[number] | "delayed";
const ROUNDTRIPS = 4;
const VERSION = process.env.VAADIN_VERSION ?? "unknown";
const RESULTS = process.env.RESULTS_FILE;

interface PanelState {
  /** Position in the parent; the id attribute is not reliable, see below. */
  id: string;
  /** Whether the id attribute reached the DOM — Flow does not bind an element that starts invisible. */
  bound: boolean;
  hiddenAttr: boolean;
  display: string;
  rendered: boolean;
}

/**
 * Panels are addressed by position, not by id: a component that is invisible when first
 * sent to the client arrives as an empty, unbound element (no attributes, no children),
 * so its id attribute is not there to look up.
 */
async function snapshot(page: Page): Promise<PanelState[]> {
  return page.evaluate(() =>
    Array.from(document.getElementById("parent")!.children).map((child, i) => {
      const el = child as HTMLElement;
      return {
        id: `panel-${i + 1}`,
        bound: el.id === `panel-${i + 1}`,
        hiddenAttr: el.hasAttribute("hidden"),
        display: getComputedStyle(el).display,
        rendered: el.getClientRects().length > 0,
      };
    }),
  );
}

/**
 * "ok" when the DOM matches the server, otherwise a compact description of the mismatch.
 * `allVisible` is the state before a delayed hide: the server still has every panel visible.
 */
function verdict(states: PanelState[], allVisible = false): string {
  const wrong = states.filter((s) => {
    const shouldShow = allVisible || s.id === "panel-1";
    return s.rendered !== shouldShow || s.hiddenAttr === shouldShow;
  });
  return wrong.length === 0
    ? "ok"
    : wrong.map((s) => `${s.id}{hidden=${s.hiddenAttr},display=${s.display}}`).join(" ");
}

async function waitForRoundtrip(page: Page, n: number): Promise<void> {
  await expect(page.locator("#server-state")).toHaveAttribute("data-roundtrips", String(n));
}

interface Case {
  kind: (typeof KINDS)[number];
  when: When;
  trigger: "button" | "textfield";
  mode: "static" | "rebuild" | "reattach" | "resend";
  style: "none" | "class" | "inline";
}

const CASES: Case[] = [
  // The setup from the conversation: nothing changes visibility after construction.
  ...KINDS.flatMap((kind) =>
    WHENS.flatMap((when) =>
      (["button", "textfield"] as const).map((trigger): Case => ({ kind, when, trigger, mode: "static", style: "none" })),
    ),
  ),
  // What real views tend to do on a roundtrip: rebuild, re-attach, or re-assert visibility.
  ...(["div", "vertical"] as const).flatMap((kind) =>
    (["rebuild", "reattach", "resend"] as const).map((mode): Case => ({ kind, when: "before", trigger: "button", mode, style: "none" })),
  ),
  // Containers that carry their own display value, competing with [hidden]. A panel that starts
  // invisible is never bound, so its class and style never reach the DOM; only a panel rendered
  // visible first and hidden later ("delayed") carries display:flex into the hidden state.
  ...(["div", "vertical"] as const).flatMap((kind) =>
    (["before", "delayed"] as const).flatMap((when) =>
      (["none", "class", "inline"] as const)
        // before/none is already covered by the first block.
        .filter((style) => when !== "before" || style !== "none")
        .map((style): Case => ({ kind, when, trigger: "textfield", mode: "static", style })),
    ),
  ),
];

for (const c of CASES) {
  const name = `${c.kind} / setVisible ${c.when} add / ${c.mode} / style ${c.style} / via ${c.trigger}`;
  test(name, async ({ page }) => {
    await page.goto(`/?kind=${c.kind}&when=${c.when}&mode=${c.mode}&style=${c.style}`);
    // childElementCount, not a "#parent > *" locator: Playwright's CSS engine pierces the
    // layout's shadow root and would count its <slot> as well.
    await expect
      .poll(() => page.evaluate(() => document.getElementById("parent")?.childElementCount ?? 0))
      .toBe(4);
    await waitForRoundtrip(page, 0);

    const sequence: string[] = [verdict(await snapshot(page), c.when === "delayed")];

    for (let n = 1; n <= ROUNDTRIPS; n++) {
      if (c.trigger === "button") {
        await page.locator("#roundtrip").click();
      } else {
        await page.locator("#field input").pressSequentially("x");
      }
      await waitForRoundtrip(page, n);
      sequence.push(verdict(await snapshot(page)));
    }

    // The server must never have changed its mind.
    await expect(page.locator("#server-state")).toHaveText(
      "panel-1=true panel-2=false panel-3=false panel-4=false",
    );

    const steps = sequence.map((v, i) => `${i === 0 ? "initial" : `rt${i}`}:${v === "ok" ? "ok" : "WRONG"}`);
    if (RESULTS) appendFileSync(RESULTS, `${VERSION}\t${name}\t${steps.join(" ")}\n`);

    expect(sequence, `DOM vs server per step (initial, rt1..rt${ROUNDTRIPS})`).toEqual(
      Array(ROUNDTRIPS + 1).fill("ok"),
    );
  });
}
