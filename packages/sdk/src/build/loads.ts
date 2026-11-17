/**
 * Where a page module would load code by a name decided when it runs.
 *
 * Bun's `scanImports` reports `import("./x.js")` and nothing for
 * `import(name)`, so a computed import passes a check built on it, and so do
 * `new Worker(url)` and `importScripts(url)`, which no import scan sees. A
 * page module may load nothing but its rules code and the files its static
 * imports name, so each of these is found here, in the module's text.
 *
 * It reads the text as JavaScript tokens, closely enough to tell code from
 * data: strings, template literals, comments and regular expressions are
 * stepped over, so a message that mentions `import(` is not a load. It is
 * not a parser, and a module that hides a load behind `globalThis["Wor" +
 * "ker"]` gets past it. What bounds that one is the page's policy, which
 * names the game's own path and nothing else.
 */

/** One place a page module loads code at run time. */
export interface RuntimeLoad {
  readonly kind:
    | "import()"
    | "new Worker"
    | "new SharedWorker"
    | "importScripts"
  /** Where it is in the text, by UTF-16 offset. */
  readonly at: number
}

/** What a `/` after it starts: a regular expression, rather than a division. */
const BEFORE_REGEX_WORDS: ReadonlySet<string> = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
])

/**
 * Punctuation a `/` after which starts a regular expression. A `)` or a `]`
 * ends an expression, so a `/` after either divides, and so does one after
 * a postfix `++` or `--`, which is read as a token of its own. A `}` most
 * often ends a block, after which a statement starts.
 */
const BEFORE_REGEX_PUNCTUATION = "(,=:[!&|?{};+-*%<>~^"

/**
 * The keywords whose parenthesised head is followed by a statement, so a
 * `/` just after its `)` starts a regular expression: `if (a) /x/.test(b)`.
 */
const CONTROL_WORDS: ReadonlySet<string> = new Set([
  "if",
  "while",
  "for",
  "with",
])

/** A line terminator, which makes a `++` or `--` after it a prefix. */
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/

const WORKERS: ReadonlySet<string> = new Set(["Worker", "SharedWorker"])

/**
 * The last thing read, which decides what a `/` means: `statement` where a
 * statement may start (the beginning of the text, or after a control
 * keyword's head), `value` after something that ends an expression, `word`
 * after an identifier or keyword that is not a property name, and
 * `punctuation` after anything else.
 */
type Last =
  | { readonly kind: "statement" }
  | { readonly kind: "value" }
  | { readonly kind: "word"; readonly word: string }
  | { readonly kind: "punctuation"; readonly char: string }

function isIdentifierChar(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char) || char.charCodeAt(0) > 0x7f
}

function isSpace(char: string): boolean {
  return /\s/.test(char)
}

/** Every `import(`, `new Worker`, `new SharedWorker` and `importScripts` call in `text`. */
export function runtimeLoads(text: string): RuntimeLoad[] {
  const found: RuntimeLoad[] = []
  const length = text.length
  /** The brace depth each open template's `${` was at. */
  const templates: number[] = []
  let depth = 0
  let last: Last = { kind: "statement" }
  let at = 0
  /** For each `(` still open, whether it is a control keyword's head. */
  const parens: boolean[] = []

  /** Past whitespace and comments, from `from`. */
  const skipGap = (from: number): number => {
    let i = from
    for (;;) {
      if (i < length && isSpace(text[i] as string)) i += 1
      else if (text.startsWith("//", i)) {
        const end = text.indexOf("\n", i)
        i = end === -1 ? length : end + 1
      } else if (text.startsWith("/*", i)) {
        const end = text.indexOf("*/", i + 2)
        i = end === -1 ? length : end + 2
      } else return i
    }
  }

  /** Past a quoted string opened at `from`. */
  const skipString = (from: number): number => {
    const quote = text[from]
    let i = from + 1
    while (i < length) {
      const char = text[i]
      if (char === "\\") i += 2
      else if (char === quote || char === "\n") return i + 1
      else i += 1
    }
    return length
  }

  /**
   * Through a template's text from `from`, to just after its closing
   * backtick, or just after a `${`, which opens an expression read as code.
   */
  const scanTemplate = (from: number): number => {
    let i = from
    while (i < length) {
      const char = text[i]
      if (char === "\\") i += 2
      else if (char === "`") {
        last = { kind: "value" }
        return i + 1
      } else if (char === "$" && text[i + 1] === "{") {
        templates.push(depth)
        depth += 1
        last = { kind: "punctuation", char: "{" }
        return i + 2
      } else i += 1
    }
    return length
  }

  /** Past a regular expression literal opened at `from`, flags and all. */
  const skipRegex = (from: number): number => {
    let i = from + 1
    let inClass = false
    while (i < length) {
      const char = text[i]
      if (char === "\\") i += 2
      else if (char === "\n") return i
      else if (inClass) {
        if (char === "]") inClass = false
        i += 1
      } else if (char === "[") {
        inClass = true
        i += 1
      } else if (char === "/") {
        i += 1
        while (i < length && isIdentifierChar(text[i] as string)) i += 1
        return i
      } else i += 1
    }
    return length
  }

  /** The identifier starting at `from`, and where it ends. */
  const wordAt = (from: number): { word: string; end: number } => {
    let i = from
    while (i < length && isIdentifierChar(text[i] as string)) i += 1
    return { word: text.slice(from, i), end: i }
  }

  const regexAllowed = (): boolean =>
    last.kind === "statement" ||
    (last.kind === "punctuation" &&
      BEFORE_REGEX_PUNCTUATION.includes(last.char)) ||
    (last.kind === "word" && BEFORE_REGEX_WORDS.has(last.word))

  /** Whether what was read last ends an expression, as an operand does. */
  const endsExpression = (): boolean =>
    last.kind === "value" ||
    (last.kind === "word" && !BEFORE_REGEX_WORDS.has(last.word))

  const afterDot = (): boolean =>
    last.kind === "punctuation" && last.char === "."

  while (at < length) {
    const gap = at
    at = skipGap(at)
    if (at >= length) break
    const char = text[at] as string

    if (char === '"' || char === "'") {
      at = skipString(at)
      last = { kind: "value" }
      continue
    }
    if (char === "`") {
      at = scanTemplate(at + 1)
      continue
    }
    if (char === "/") {
      if (regexAllowed()) {
        at = skipRegex(at)
        last = { kind: "value" }
      } else {
        at += 1
        last = { kind: "punctuation", char }
      }
      continue
    }
    if (char === "{") {
      depth += 1
      at += 1
      last = { kind: "punctuation", char }
      continue
    }
    if (char === "}") {
      depth -= 1
      at += 1
      if (templates.length > 0 && templates[templates.length - 1] === depth) {
        // The end of a template's `${...}`: its text carries on.
        templates.pop()
        at = scanTemplate(at)
        continue
      }
      last = { kind: "punctuation", char }
      continue
    }
    if (
      /[0-9]/.test(char) ||
      (char === "." && /[0-9]/.test(text[at + 1] ?? ""))
    ) {
      at += 1
      while (at < length && /[0-9A-Za-z_.]/.test(text[at] as string)) at += 1
      last = { kind: "value" }
      continue
    }
    if (isIdentifierChar(char)) {
      const { word, end } = wordAt(at)
      const next = skipGap(end)
      if (word === "import" && !afterDot() && text[next] === "(") {
        found.push({ kind: "import()", at })
      } else if (word === "importScripts" && text[next] === "(") {
        found.push({ kind: "importScripts", at })
      } else if (word === "importScripts" && text.startsWith("?.(", next)) {
        found.push({ kind: "importScripts", at })
      } else if (word === "new" && !afterDot()) {
        // `new Worker(`, `new self.Worker(`, `new globalThis.SharedWorker(`.
        let i = next
        let named = ""
        for (;;) {
          if (!isIdentifierChar(text[i] ?? " ")) break
          const part = wordAt(i)
          named = part.word
          i = skipGap(part.end)
          if (text[i] !== ".") break
          i = skipGap(i + 1)
        }
        if (WORKERS.has(named)) {
          found.push({ kind: `new ${named}` as RuntimeLoad["kind"], at })
        }
      }
      at = end
      // A property name is an operand whatever it spells.
      last = afterDot() ? { kind: "value" } : { kind: "word", word }
      continue
    }
    if ((char === "+" || char === "-") && text[at + 1] === char) {
      // Postfix after an operand on the same line, which ends the
      // expression; prefix otherwise, before its operand.
      const postfix =
        endsExpression() && !LINE_TERMINATOR.test(text.slice(gap, at))
      at += 2
      last = postfix ? { kind: "value" } : { kind: "punctuation", char }
      continue
    }
    if (char === "(") {
      parens.push(last.kind === "word" && CONTROL_WORDS.has(last.word))
      at += 1
      last = { kind: "punctuation", char }
      continue
    }
    if (char === ")") {
      at += 1
      last = parens.pop() === true ? { kind: "statement" } : { kind: "value" }
      continue
    }
    at += 1
    last = char === "]" ? { kind: "value" } : { kind: "punctuation", char }
  }
  return found
}
