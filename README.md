# @lp-labs/validation

Small runtime schemas for validating unknown values, composing reusable rules,
and inferring TypeScript output types. Validation failures expose structured
codes, messages, and paths.

## Import

```ts
import { object, string, number, array, ValidationError } from "@lp-labs/validation";

const User = object({
  name: string({ minLength: 1 }),
  age: number({ min: 0, integer: true }).optional(),
});
```

The package provides ESM and CommonJS entry points with matching TypeScript
declarations. It has no runtime dependencies and requires Node.js 18 or newer.

## Runtime API

- `Schema<T>` is the composable schema class. `parse(input)` returns a `T` or
  throws `ValidationError`; `safeParse(input)` returns a discriminated success
  or failure result. `.optional()` accepts `undefined`, `.nullable()` accepts
  `null`, and `.refine(predicate, message, code?)` adds a custom constraint.
  Custom schemas can be constructed with `new Schema((input, path) => value)`;
  the callback must throw `ValidationError` for invalid input.
- `ValidationError` extends `Error` and exposes `issues`. Each
  `ValidationIssue` is `{ code, message, path }`, where path is an array of
  string object keys and numeric array indexes. The human-readable message
  prefixes each issue with a `$`-rooted path.
- `unknown()` accepts any input unchanged.
- `string(options?)` checks strings. `minLength`, `maxLength`, `pattern`, and
  `patternMessage` are optional.
- `number(options?)` accepts only finite numbers. `min`, `max`, and `integer`
  are optional.
- `boolean()` accepts only booleans.
- `literal(value)` checks exact string, number, boolean, or null values.
  Numeric literals must be finite.
- `enumeration(values)` checks membership in a non-empty readonly tuple of
  strings and infers the tuple's union.
- `array(itemSchema, options?)` validates every item and supports `minLength`
  and `maxLength`.
- `object(shape, options?)` validates the declared own properties of a plain
  or null-prototype object. `unknownKeys` defaults to `"strip"`; `"strict"`
  rejects undeclared keys; `"passthrough"` preserves safe undeclared keys.
  Inherited properties are not used. Prototype-bearing class instances and
  unsafe keys (`__proto__`, `constructor`, and `prototype`) are rejected.
- `union(schemas)` accepts the first successful schema; otherwise its
  `ValidationError` includes an `invalid_union` issue and the member issues.

The runtime exports are `Schema`, `ValidationError`, `unknown`, `string`,
`number`, `boolean`, `literal`, `enumeration`, `array`, `object`, and `union`.
`PathSegment`, `ValidationIssue`, `SafeParseResult`, `ParseContext`, `Infer`,
`Shape`, `InferShape`, `StringOptions`, `NumberOptions`, and `ObjectOptions`
are TypeScript-only exports.

Option bounds are inclusive. Strings use JavaScript UTF-16 code-unit length;
regular expressions use JavaScript `RegExp` semantics. Schemas do not coerce
values. Objects consider enumerable own string keys; symbols and non-enumerable
properties are ignored. Optional object properties are omitted from parsed
output when absent.

## Example

```ts
const User = object({
  name: string({ minLength: 1 }),
  age: number({ min: 0, integer: true }).optional(),
  tags: array(string(), { maxLength: 10 }),
});

type User = Infer<typeof User>;
const result = User.safeParse(untrustedInput);
if (result.success) {
  const user: User = result.data;
  console.log(user.name);
} else {
  for (const issue of result.error.issues) {
    console.error(issue.path, issue.code, issue.message);
  }
}

try {
  User.parse(untrustedInput);
} catch (error) {
  if (error instanceof ValidationError) console.error(error.issues);
}
```

## Typing and limits

`Infer<typeof schema>` derives a schema's output type, including optional
properties. The schemas perform synchronous validation and return the validated
value (objects are rebuilt rather than returned by reference). They do not
coerce, asynchronously validate, transform values, or define application-level
error localization. `"passthrough"` unknown keys are safe own properties at
runtime but are intentionally not added to the statically inferred declared
shape.
`safeParse` converts only `ValidationError` failures into its failure result;
unexpected errors thrown by custom parsers, predicates, getters, or proxies
propagate to the caller.

## License

[MIT](./LICENSE).

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
