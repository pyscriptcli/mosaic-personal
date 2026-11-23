import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import ts from "typescript";

const app = fileURLToPath(new URL("../", import.meta.url));
const theme = readFileSync(path.join(app, "src/app/theme.css"), "utf8");
const colors = Object.fromEntries([...theme.matchAll(/--mosaic-([\w-]+):\s*(#[\da-f]{6});/gi)].map((match) => [match[1], match[2]]));
const errors = [];
for (const role of Object.keys(colors)) {
  if (!theme.includes(`--color-${role}: var(--mosaic-${role});`)) errors.push(`Tailwind alias for ${role} must use the shared palette`);
}

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((value) => parseInt(value, 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

// Reference cases protect the calculation itself, including threshold rounding.
assert.equal(contrast("#000000", "#ffffff"), 21);
assert.equal(contrast("#ffffff", "#ffffff"), 1);
assert.ok(contrast("#777777", "#ffffff") < 4.5);

let pairs = 0;
function pair(foreground, background, minimum) {
  if (!colors[foreground] || !colors[background]) {
    errors.push(`Missing token: ${foreground} or ${background}`);
    return;
  }
  pairs++;
  const ratio = contrast(colors[foreground], colors[background]);
  if (ratio < minimum) errors.push(`${foreground} on ${background}: ${ratio.toFixed(2)}:1, requires ${minimum}:1`);
}

for (const surface of ["surface-canvas", "surface-panel", "surface-raised", "surface-hover", "surface-selected"]) {
  for (const foreground of ["fg", "fg-secondary", "fg-muted", "link"]) pair(foreground, surface, 4.5);
  pair("focus", surface, 3);
  // Fields render on neutral surfaces. Selected items use the distinct focus accent.
  if (surface !== "surface-selected") pair("control-border", surface, 3);
}
for (const status of ["warning", "success", "danger", "info", "special"]) {
  pair(`${status}-fg`, `${status}-surface`, 4.5);
  pair("fg", `${status}-surface`, 4.5);
  pair(`${status}-border`, `${status}-surface`, 3);
  for (const surface of ["surface-panel", "surface-canvas"]) {
    pair(`${status}-fg`, surface, 4.5);
    pair(`${status}-border`, surface, 3);
  }
}
for (const action of ["action", "action-hover", "danger-action", "danger-action-hover", "success-action", "success-action-hover"]) pair("on-action", action, 4.5);
pair("fg", "action", 4.5);
pair("disabled-fg", "disabled-surface", 4.5);
pair("link", "warning-surface", 4.5);

function* files(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* files(location);
    else yield location;
  }
}

// Historical mockups and original artwork are intentionally independent of the UI.
const sourceFiles = [...files(path.join(app, "src"))].filter((file) => /\.(tsx|css)$/.test(file) && !file.includes("ui-mockups") && !file.includes(".test.") && !file.endsWith("theme.css"));
let explicitPairs = 0;
const reminder = readFileSync(path.join(app, "../src/reminder.html"), "utf8");
if (!reminder.includes('href="../app/src/app/theme.css"')) errors.push("Native reminder must load the shared theme");
if (!readFileSync(path.join(app, "../electron-builder.yml"), "utf8").includes("- app/src/app/theme.css")) errors.push("Electron packaging must include the native reminder stylesheet");
if (/#([\da-f]{3,8})\b/i.test(reminder)) errors.push("Native reminder has hard-coded colors outside the shared palette");
for (const match of reminder.matchAll(/var\(--mosaic-([\w-]+)\)/g)) {
  if (!colors[match[1]]) errors.push(`Native reminder uses undefined role ${match[1]}`);
}
const rawPalette = /\b(?:bg|text|border(?:-[trblxy])?|ring(?:-offset)?|outline|divide|placeholder|accent|fill|stroke|from|via|to|decoration)-(?:\[(?:#|rgb|hsl|oklch)[^\]]+\]|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+|white|black|brand-[\w-]+|vscode-[\w-]+)/g;
assert.ok("hover:bg-amber-100 text-[#003366]".match(rawPalette)?.length === 2);
assert.equal("bg-warning-surface text-warning-fg".match(rawPalette), null);
for (const file of sourceFiles) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(rawPalette)) {
    const line = source.slice(0, match.index).split("\n").length;
    errors.push(`${path.relative(app, file)}:${line}: replace ${match[0]} with a semantic role`);
  }
  if (/\[class[*~^$|]?=/.test(source) && file.endsWith(".css")) errors.push(`${path.relative(app, file)}: class-fragment theme overrides are forbidden`);
  if (/#([\da-f]{3,8})\b/i.test(source)) errors.push(`${path.relative(app, file)}: move hard-coded UI colors into theme.css`);
  for (const match of source.matchAll(/\b(?:bg|text|border|outline|ring)-((?:surface-|fg|warning-|success-|danger-|info-|special-|action|link|focus|control-border|on-action|disabled-)[\w-]*)(?:\/(?:\[[^\]]+\]|\d+))?/g)) {
    const token = match[1];
    if (!colors[token]) errors.push(`${path.relative(app, file)}: undefined theme role ${token}`);
    if (match[0].includes("/")) errors.push(`${path.relative(app, file)}: ${match[0]} changes the checked color pair; use an opaque role`);
  }
  if (!file.endsWith(".tsx")) continue;
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const tokens = node.text.split(/\s+/);
      const roles = (prefix, property) => tokens.filter((token) => token.startsWith(`${prefix}${property}-`) && colors[token.slice(prefix.length + property.length + 1)]).map((token) => token.slice(prefix.length + property.length + 1));
      for (const state of ["", "hover:", "focus:", "disabled:"]) {
        const backgrounds = roles(state, "bg");
        const foregrounds = roles(state, "text");
        const bg = backgrounds.length ? backgrounds : roles("", "bg");
        const fg = foregrounds.length ? foregrounds : roles("", "text");
        if (bg.length !== 1 || fg.length !== 1 || (state && !backgrounds.length && !foregrounds.length)) continue;
        explicitPairs++;
        const ratio = contrast(colors[fg[0]], colors[bg[0]]);
        if (ratio < 4.5) {
          const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
          errors.push(`${path.relative(app, file)}:${line}: ${state || "normal "}${fg[0]} on ${bg[0]} is ${ratio.toFixed(2)}:1, requires 4.5:1`);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Theme checks passed: ${pairs} contract pairs, ${explicitPairs} explicit UI/state pairs; ${sourceFiles.length} UI sources and the native reminder use shared colors.`);
}
