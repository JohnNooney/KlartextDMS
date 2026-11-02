# Gemini structured output: root-level `anyOf` via Firebase AI Logic

Research for issue #175 (part of #174; feeds the decision in #137).
Stack in question: `firebase/ai` web SDK, `GoogleAIBackend`, `gemini-2.5-flash`,
`generationConfig.responseSchema` (the `extractionResponseSchema` in
`apps/guest/src/extraction/extraction-schema.ts`, used by
`apps/guest/src/extraction/run-extraction-job.ts`).

Installed versions: `firebase@12.19.0` → `@firebase/ai@2.16.0`
(`node_modules/.pnpm/@firebase+ai@2.16.0_…/node_modules/@firebase/ai/dist`).

## TL;DR

- Root-level `anyOf` is **allowed by every layer**: the SDK types it, the SDK
  forwards it untouched, and the Gemini API `Schema` object has `anyOf` on every
  node, the root included. **No primary source mentions root-level `anyOf`
  specifically**, and none gives numeric limits (variant count, depth). The
  documented limit is a vague "schema too complex" `400 INVALID_ARGUMENT`, and
  "`anyOf` with many alternatives" is named as one cause.
- `anyOf` and `required` are compiled into the constrained-decoding grammar
  (they are not on the documented "unenforced" list, and the complexity error is
  worded in grammar terms: "too many states or too much branching"). So per-variant
  `required` is **enforced, not a hint**, as far as the docs say. Google still says to validate
  the output, so keep the Zod audit.
- There is **no conditional keyword** (`if/then/else`, `dependentRequired`,
  `dependentSchemas`, `allOf`, `not`, `const` are all absent from the supported
  subset). "Field required iff enum == X" can only be expressed as a
  discriminated `anyOf`. It does **not** need one variant per enum value: two
  variants (enum `['OTHER']` with the label required, and an enum of the other
  values without it) are enough. Several independent conditionals at the root
  multiply into a cross-product of variants, and each variant repeats the full
  object (including the nested `timing` anyOf). That growth is exactly what the
  complexity limit punishes.

## 1. Is root-level `anyOf` documented/supported?

### Firebase AI Logic SDK (`firebase/ai`)

- `Schema.anyOf({ anyOf: TypedSchema[] })` is a public static builder that returns
  `AnyOfSchema` ([ref](https://firebase.google.com/docs/reference/js/ai.schema)).
  `Schema.type` is documented as "Optional… This can only be undefined when using
  `anyOf` schemas".
- `GenerationConfig.responseSchema?: TypedSchema | SchemaRequest`, and
  `TypedSchema` includes `AnyOfSchema` (`dist/ai-public.d.ts` lines 1089, 3380).
  So an `AnyOfSchema`, or a plain `SchemaRequest` with `anyOf` and no `type`, is
  type-valid **as the root** of `responseSchema`. `SchemaShared.anyOf?: T[]`
  (line 2765) lets the plain-object form put `anyOf` on any node.
- Serialization (`dist/esm/index.esm.js`):
  - Plain `SchemaRequest` objects (what the repo uses) are **not transformed**.
    They are JSON-serialized as-is. `mapGenerateContentRequest` for the Google AI
    backend (line 1970) only checks `safetySettings[].method` and rounds `topK`.
  - `AnyOfSchema` constructor (line 4301) throws `INVALID_SCHEMA` on an empty
    `anyOf` and forces `type: undefined`. `toJSON()` serializes each variant.
  - **Builder pitfall:** the base `Schema.toJSON()` (line 4129) keeps `required` only
    when `type === 'object'`. A `required` set on the `anyOf` node itself is dropped,
    so put `required` inside each object variant. `ObjectSchema.toJSON()`
    (line 4270) makes **every property required** unless it is listed in
    `optionalProperties`.
  - `validateGenerationConfig` (line 3271) rejects setting both `responseSchema` and
    `responseJsonSchema`, and requires `responseMimeType` `application/json` or
    `text/x.enum`.
- The Firebase guide lists only `enum, items, maxItems, nullable, properties,
  required` as supported fields and says "If you use an unsupported field, the model
  can still handle your request, but it ignores the field"
  ([guide](https://firebase.google.com/docs/ai-logic/generate-structured-output)).
  `anyOf` is not in that table. The SDK forwards it, though, and the backend Gemini API
  documents it (below). The table is out of date relative to the SDK, not a
  prohibition. Expect any enforcement to come from the Gemini API, not from Firebase.
- `responseJsonSchema?: {[key: string]: unknown}` is also available (d.ts line
  1097) and is forwarded opaquely.

### Gemini API (`responseSchema`, the OpenAPI subset)

- The `Schema` object is "a select subset of an OpenAPI 3.0 schema object" and has
  `anyOf[]`: "The value should be validated against any (one or more) of the
  subschemas in the list". It also has `required[]`, `minItems`/`maxItems`,
  `propertyOrdering[]`, `nullable`, `enum`, `minimum`/`maximum`
  ([API ref – Schema](https://ai.google.dev/api/generate-content#v1beta.Schema)).
  The root of `responseSchema` is just a `Schema`, so root-level `anyOf` is
  structurally valid. The reference marks `type` as "Required", but the SDK
  deliberately omits it for `anyOf` nodes, as above.
- `GenerationConfig.responseSchema` is now marked **deprecated** in favour of
  `responseFormat`, alongside `responseJsonSchema`
  ([API ref – GenerationConfig](https://ai.google.dev/api/generate-content#v1beta.GenerationConfig)).
  It still works, and the installed SDK has no `responseFormat` field.

### Gemini API (`responseJsonSchema`, the JSON Schema subset)

- Supported keywords: `$id, $defs, $ref, $anchor, type, format, title, description,
  enum, items, prefixItems, minItems, maxItems, minimum, maximum, anyOf, oneOf
  (interpreted the same as anyOf), properties, additionalProperties, required`, plus
  non-standard `propertyOrdering`. If a sub-schema has `$ref`, it may carry no other
  non-`$` keys. Cyclic refs are only allowed in non-required properties
  ([API ref – GenerationConfig](https://ai.google.dev/api/generate-content#v1beta.GenerationConfig)).
- Guide example uses `anyOf` of two object variants, each with its own `required`
  ("`anyOf` for conditional schemas"). The example puts it on a **nested** property
  (`decision`), not at the root
  ([structured output, generateContent](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)).

### Limits

- **Variant count / nesting depth:** no numeric limit is documented anywhere. The
  only stated limit: "Very large or deeply nested schemas may be rejected with a
  `400 INVALID_ARGUMENT` error that says the schema produces a constraint with too
  many states or too much branching for serving. Common causes are large `maxItems`
  limits (especially on nested arrays), very long property or enum names, enums with
  many values, long runs of optional properties, `anyOf` with many alternatives, and
  numeric `minimum`/`maximum` bounds. To fix it, lower or remove nested array limits,
  shorten names, or intersperse required properties among optional ones."
  ([structured output, Limitations](https://ai.google.dev/gemini-api/docs/structured-output#limitations)).
  The response schema also counts toward the input-token limit
  ([Firebase guide](https://firebase.google.com/docs/ai-logic/generate-structured-output)).
- **Per-variant `required`:** supported. Each variant is a full `Schema` with its own
  `required[]` (API ref; guide example).
- **`maxItems: 0`:** not mentioned specifically. `minItems`/`maxItems` "are enforced"
  by constrained decoding ([Limitations](https://ai.google.dev/gemini-api/docs/structured-output#limitations)),
  and `maxItems` is in the Firebase field table. `0` is a legal value, but there is
  no explicit primary-source statement about it, so verify it empirically.
- **Property ordering:** for JSON Schema, "the model will produce outputs in the
  same order as the keys in the schema"
  ([generateContent guide](https://ai.google.dev/gemini-api/docs/generate-content/structured-output#json-schema-support)).
  For the OpenAPI `Schema`, `propertyOrdering[]` is "Used to determine the order of
  the properties in the response" (API ref). It is per-object, so each `anyOf` variant
  carries its own. Gemini 2.0 *requires* explicit `propertyOrdering`. 2.5 does not
  (model-support table, same guide).
- **Ignored keywords:** `minLength, maxLength, minProperties, maxProperties,
  uniqueItems, contains, minContains, maxContains` are stripped and not enforced
  ([Limitations](https://ai.google.dev/gemini-api/docs/structured-output#limitations)).

## 2. Does constrained decoding enforce per-variant `required`?

What the docs say, without having been tested here: **enforced as part of the grammar, not a hint.**

- "The model will then generate a response that is a syntactically valid JSON string
  matching the provided schema"
  ([generateContent guide](https://ai.google.dev/gemini-api/docs/generate-content/structured-output#json-schema-support)).
- The Limitations section lists exactly which keywords the "constrained decoding
  grammar engine" does **not** enforce. Neither `anyOf` nor `required` is on that list,
  and `minItems`/`maxItems` "are enforced". The "too much branching" complexity error
  means `anyOf` alternatives become grammar branches
  ([Limitations](https://ai.google.dev/gemini-api/docs/structured-output#limitations)).
- The API ref wording is "validated against any (one or more) of the subschemas".
  That is `anyOf` semantics, **not `oneOf`**. A value matching several variants is
  legal, and in `responseJsonSchema` `oneOf` is explicitly downgraded to `anyOf`.
  Exclusivity (for example "label must be absent unless OTHER") therefore depends on
  whether each variant's `properties` leaves the field undeclared. It also depends on
  how unlisted properties are handled (`additionalProperties`, which exists only in
  `responseJsonSchema`). Keep checking absence in Zod.
- Caveats from Google itself: "While structured output guarantees syntactically
  correct JSON, it does not guarantee the values are semantically correct. Always
  validate…" (same guide, Best practices). Also, the Firebase guide says
  *unsupported* fields are silently ignored, so a misspelled or unsupported keyword
  quietly fails to enforce anything rather than erroring.
- Repo evidence: the nested `timing` anyOf (commit `d111ade`, #138) was introduced
  because the flat schema let the model omit `anchor`/`scheduleLabel`, and per-variant
  `required` was the fix. That is the same mechanism, applied one level down.

## 3. "Field required iff enum == X" without one variant per value? Complexity limits?

- **No conditional keyword exists** in either subset. `if/then/else`,
  `dependentRequired`, `dependentSchemas`, `allOf`, `not`, `const` are absent from the
  `responseJsonSchema` list (API ref – GenerationConfig) and from the OpenAPI `Schema`
  object (API ref – Schema). Per the Firebase guide and the generateContent guide
  ("The model ignores unsupported properties"), they would be **silently ignored**.
- **The only route is a discriminated `anyOf`**, but the variant count follows the
  number of *distinct requirement shapes*, not the number of enum values:
  - `documentTypeLabel` iff `OTHER` → 2 variants: `{documentType: enum ['OTHER'],
    documentTypeLabel required}` and `{documentType: enum [5 other values]}` with no
    label declared.
  - `statusExplanation` iff non-`COMPLETE`, plus empty lists when non-`COMPLETE` →
    2 variants: `{extractionStatus: enum ['COMPLETE'], …lists…}` and
    `{extractionStatus: enum ['INSUFFICIENT_CONTENT','UNSUPPORTED_DOCUMENT'],
    statusExplanation required, actionItems/keyTakeaways maxItems 0}`.
  - **At the root these combine as a cross-product** (2 × 2 = 4 variants), because
    `anyOf` has no `allOf` to compose them. Each variant restates the whole object,
    including `actionItems` with its 4-way `timing` anyOf, `maxItems` 6/10 arrays and
    numeric `minimum`/`maximum` bounds. Those are all named complexity drivers.
- **Ways to keep it smaller** (all within documented features):
  - Move each conditional pair into a **nested** object property, for example
    `classification: anyOf[…]` and `status: anyOf[…]`. The conditionals then add up
    (2 + 2) instead of multiplying, and the arrays are not duplicated. This changes the
    wire shape, so the provider would have to flatten it back to `ExtractionContent`.
  - The non-`COMPLETE` variant can declare the lists with `maxItems: 0`, or omit them
    and let the provider default them to `[]`, which avoids duplicating the
    `actionItems` sub-schema.
  - With `responseJsonSchema`, `$defs` + `$ref` can share the `actionItems` /
    `keyTakeaways` sub-schemas across root variants. This reduces schema text and
    tokens, though not necessarily grammar states. A `$ref` node may carry no
    sibling keywords.
- **Complexity limits:** only the qualitative `400 INVALID_ARGUMENT` "too many states
  or too much branching" described above. There are no published numbers, so a root
  cross-product has to be tested against `gemini-2.5-flash` directly.

## Recommended next step (not done here)

A short live spike: send the 4-variant root `anyOf` (and the nested alternative)
through `firebase/ai` with `GoogleAIBackend`/`gemini-2.5-flash`. Check (a) no `400`,
(b) over N runs on `OTHER` / non-`COMPLETE` fixtures, whether the label and explanation are
always present and the lists are empty, and (c) latency and token cost. The docs
cannot answer acceptance and reliability at this specific shape.

## Sources

- Firebase AI Logic – Generate structured output:
  https://firebase.google.com/docs/ai-logic/generate-structured-output
- Firebase JS reference – `Schema` (incl. `Schema.anyOf`, `type` optional for anyOf):
  https://firebase.google.com/docs/reference/js/ai.schema
- Gemini API reference – `Schema` and `GenerationConfig` (`responseSchema`,
  `responseJsonSchema` supported-keyword list):
  https://ai.google.dev/api/generate-content
- Gemini API – Structured outputs (generateContent): https://ai.google.dev/gemini-api/docs/generate-content/structured-output
- Gemini API – Structured outputs (Limitations, enforced/unenforced keywords, complexity error):
  https://ai.google.dev/gemini-api/docs/structured-output
- SDK source: `@firebase/ai@2.16.0` `dist/ai-public.d.ts` (lines 177, 1089, 1097,
  2715, 2744–2790, 3380) and `dist/esm/index.esm.js` (lines 1970, 3271–3290,
  4129–4141, 4258–4323), installed via `firebase@12.19.0`.
