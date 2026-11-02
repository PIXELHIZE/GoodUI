import selectorParser from 'postcss-selector-parser';

/** Whitespace and variant separators inside arbitrary values are not delimiters. */
export function splitClasses(text: string): string[] {
  const tokens: string[] = [];
  let token = '', depth = 0, quote = '', escaped = false;
  for (const character of text) {
    if (escaped) { token += character; escaped = false; continue; }
    if (character === '\\') { token += character; escaped = true; continue; }
    if (quote) { token += character; if (character === quote) quote = ''; continue; }
    if (depth > 0 && (character === '"' || character === "'")) { quote = character; token += character; continue; }
    if ('[({'.includes(character)) depth++;
    if ('])}'.includes(character)) depth = Math.max(0, depth - 1);
    if (/\s/.test(character) && depth === 0) { if (token) tokens.push(token); token = ''; }
    else token += character;
  }
  if (token) tokens.push(token);
  return tokens;
}

export function baseClass(token: string): string {
  let depth = 0, start = 0, quote = '', escaped = false;
  for (let i = 0; i < token.length; i++) {
    const character = token[i]!;
    if (escaped) { escaped = false; continue; }
    if (character === '\\') { escaped = true; continue; }
    if (quote) { if (character === quote) quote = ''; continue; }
    if (depth > 0 && (character === '"' || character === "'")) { quote = character; continue; }
    if ('[({'.includes(character)) depth++;
    else if ('])}'.includes(character)) depth--;
    else if (character === ':' && depth === 0) start = i + 1;
  }
  return token.slice(start).replace(/^!/, '').replace(/!$/, '');
}

/** Class globs deliberately treat brackets literally; only * and ? are wildcards. */
export function matchesClass(token: string, patterns: readonly string[] = []): boolean {
  const values = [token, baseClass(token)];
  return patterns.some(pattern => {
    const regex = new RegExp(`^${pattern.split('').map(character => character === '*' ? '.*' : character === '?' ? '.' : character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('')}$`);
    return values.some(value => regex.test(value));
  });
}

export function distance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  for (let row = 1; row <= left.length; row++) {
    const current = [row];
    for (let column = 1; column <= right.length; column++) current[column] = Math.min(current[column - 1]! + 1, previous[column]! + 1, previous[column - 1]! + (left[row - 1] === right[column - 1] ? 0 : 1));
    previous = current;
  }
  return previous[right.length]!;
}

export function nearest(value: string, candidates: Iterable<string>, count = 3): string[] {
  const unique = [...new Set(candidates)];
  const prefix = value.split('-')[0]!;
  const related = unique.filter(candidate => baseClass(candidate).split('-')[0] === prefix);
  return (related.length ? related : unique.filter(candidate => Math.abs(baseClass(candidate).length - value.length) <= 3)).map(candidate => ({ candidate, score: distance(value, baseClass(candidate)) })).sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate)).slice(0, count).map(item => item.candidate);
}

/** Reads class selectors, including CSS escapes, while ignoring attribute strings. */
export function selectorClasses(selector: string): string[] {
  const classes: string[] = [];
  try { selectorParser(selectors => { selectors.walkClasses(node => { classes.push(node.value); }); }).processSync(selector); }
  catch { /* An unreadable selector never grants a class an exemption. */ }
  return classes;
}

export function rawColor(value: string): boolean {
  const text = value.trim().replaceAll('_', ' ');
  if (/^(?:none|inherit|initial|unset|revert|transparent|currentcolor)$/i.test(text) || /^url\(/i.test(text)) return false;
  const fallback = /^var\([^,]+,(.*)\)$/is.exec(text)?.[1];
  if (fallback !== undefined && rawColor(fallback)) return true;
  return /#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/i.test(text) || NAMED_COLORS.has(text.toLowerCase());
}

const NAMED_COLORS = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgrey darkgreen darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray grey green greenyellow honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgrey lightgreen lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen').split(' '));

export function colorClass(token: string): { raw: boolean; color?: string; utility?: string } {
  const base = baseClass(token);
  const match = /^(bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|outline|divide|decoration|fill|stroke|shadow|from|via|to|accent|caret)-(.+)$/.exec(base);
  if (match) {
    const color = match[2]!.replace(/\/(?:\d+|\[[^\]]+\])$/, '');
    const palette = /^(?:(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950)|black|white)$/.test(color);
    return { raw: palette || rawColor(color.replace(/^\[|\]$/g, '')), color, utility: match[1] };
  }
  return { raw: /^\[(?:color|background(?:-color)?|border(?:-[\w-]+)?|fill|stroke):/.test(base) && rawColor(base) };
}

export function restyleCategory(token: string): string | undefined {
  const base = baseClass(token).replace(/^-/, '');
  if (/^(?:m[trblxyse]?|space-[xy]|gap(?:-[xy])?)-/.test(base)) return undefined;
  if (/^(?:p[trblxyse]?|w|h|min-w|max-w|min-h|max-h|size)-/.test(base)) return 'size and internal spacing';
  if (/^(?:bg|text|font|leading|tracking|decoration|placeholder|list|indent|align|whitespace|break|hyphens)-/.test(base)) return 'color and typography';
  if (/^(?:border|rounded|ring|outline|shadow|opacity|fill|stroke|divide|filter|blur|backdrop|transition|duration|ease|animate|scale|rotate|skew)-/.test(base)) return 'appearance';
  return undefined;
}
