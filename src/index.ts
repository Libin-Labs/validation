export type PathSegment = string | number;

export interface ValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly path: readonly PathSegment[];
}

export class ValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super(issues.map((issue) => `${formatPath(issue.path)}: ${issue.message}`).join('\n'));
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

export type SafeParseResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: ValidationError };

export interface ParseContext {
  readonly path: readonly PathSegment[];
}

type Parser<T> = (input: unknown, path: readonly PathSegment[]) => T;
const parsers = new WeakMap<Schema<unknown>, Parser<unknown>>();

export class Schema<T> {
  constructor(parser: Parser<T>) {
    parsers.set(this as Schema<unknown>, parser as Parser<unknown>);
  }

  parse(input: unknown): T {
    return parseAt(this, input, []);
  }

  safeParse(input: unknown): SafeParseResult<T> {
    try {
      return { success: true, data: this.parse(input) };
    } catch (error) {
      if (error instanceof ValidationError) return { success: false, error };
      throw error;
    }
  }

  optional(): Schema<T | undefined> {
    return new Schema((input, path) =>
      input === undefined ? undefined : parseAt(this, input, path),
    );
  }

  nullable(): Schema<T | null> {
    return new Schema((input, path) => (input === null ? null : parseAt(this, input, path)));
  }

  refine(predicate: (value: T) => boolean, message: string, code = 'custom'): Schema<T> {
    return new Schema((input, path) => {
      const value = parseAt(this, input, path);
      if (!predicate(value)) fail(code, message, path);
      return value;
    });
  }
}

export type Infer<S extends Schema<unknown>> = S extends Schema<infer T> ? T : never;
export type Shape = Readonly<Record<string, Schema<unknown>>>;
export type InferShape<S extends Shape> = {
  [K in keyof S as undefined extends Infer<S[K]> ? K : never]?: Infer<S[K]>;
} & {
  [K in keyof S as undefined extends Infer<S[K]> ? never : K]: Infer<S[K]>;
};

export interface StringOptions {
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: RegExp;
  readonly patternMessage?: string;
}

export interface NumberOptions {
  readonly min?: number;
  readonly max?: number;
  readonly integer?: boolean;
}

export interface ObjectOptions {
  readonly unknownKeys?: 'strip' | 'strict' | 'passthrough';
}

export const unknown = (): Schema<unknown> => new Schema((input) => input);

export const string = (options: StringOptions = {}): Schema<string> => {
  validateLengthBounds(options.minLength, options.maxLength);
  if (options.pattern !== undefined && !(options.pattern instanceof RegExp)) {
    throw new TypeError('Pattern must be a RegExp.');
  }
  return new Schema((input, path) => {
    if (typeof input !== 'string') fail('invalid_type', 'Expected a string.', path);
    if (options.minLength !== undefined && input.length < options.minLength) {
      fail('too_small', `Expected at least ${options.minLength} characters.`, path);
    }
    if (options.maxLength !== undefined && input.length > options.maxLength) {
      fail('too_big', `Expected at most ${options.maxLength} characters.`, path);
    }
    if (options.pattern && !testPattern(options.pattern, input)) {
      fail('invalid_string', options.patternMessage ?? 'String does not match the pattern.', path);
    }
    return input;
  });
};

export const number = (options: NumberOptions = {}): Schema<number> => {
  if (
    (options.min !== undefined && !Number.isFinite(options.min)) ||
    (options.max !== undefined && !Number.isFinite(options.max)) ||
    (options.min !== undefined && options.max !== undefined && options.min > options.max)
  ) {
    throw new RangeError('Number bounds must be finite and min must not exceed max.');
  }
  return new Schema((input, path) => {
    if (typeof input !== 'number' || !Number.isFinite(input)) {
      fail('invalid_type', 'Expected a finite number.', path);
    }
    if (options.integer && !Number.isInteger(input))
      fail('not_integer', 'Expected an integer.', path);
    if (options.min !== undefined && input < options.min) {
      fail('too_small', `Expected a number greater than or equal to ${options.min}.`, path);
    }
    if (options.max !== undefined && input > options.max) {
      fail('too_big', `Expected a number less than or equal to ${options.max}.`, path);
    }
    return input;
  });
};

export const boolean = (): Schema<boolean> =>
  new Schema((input, path) => {
    if (typeof input !== 'boolean') fail('invalid_type', 'Expected a boolean.', path);
    return input;
  });

export const literal = <const T extends string | number | boolean | null>(
  expected: T,
): Schema<T> => {
  if (expected !== null && !['string', 'number', 'boolean'].includes(typeof expected)) {
    throw new TypeError('Literal values must be string, number, boolean, or null.');
  }
  if (typeof expected === 'number' && !Number.isFinite(expected)) {
    throw new RangeError('Numeric literals must be finite.');
  }
  return new Schema((input, path) => {
    if (!Object.is(input, expected)) fail('invalid_literal', `Expected ${String(expected)}.`, path);
    return expected;
  });
};

export const enumeration = <const T extends readonly [string, ...string[]]>(
  values: T,
): Schema<T[number]> => {
  if (values.length === 0) throw new RangeError('Enumeration values cannot be empty.');
  if (values.some((value) => typeof value !== 'string')) {
    throw new TypeError('Enumeration values must be strings.');
  }
  const allowed = [...values];
  return new Schema((input, path) => {
    if (typeof input !== 'string' || !allowed.includes(input)) {
      fail('invalid_enum', `Expected one of: ${allowed.join(', ')}.`, path);
    }
    return input as T[number];
  });
};

export const array = <S extends Schema<unknown>>(
  itemSchema: S,
  options: { readonly minLength?: number; readonly maxLength?: number } = {},
): Schema<Infer<S>[]> => {
  validateLengthBounds(options.minLength, options.maxLength);
  return new Schema((input, path) => {
    if (!Array.isArray(input)) fail('invalid_type', 'Expected an array.', path);
    if (options.minLength !== undefined && input.length < options.minLength) {
      fail('too_small', `Expected at least ${options.minLength} items.`, path);
    }
    if (options.maxLength !== undefined && input.length > options.maxLength) {
      fail('too_big', `Expected at most ${options.maxLength} items.`, path);
    }
    const issues: ValidationIssue[] = [];
    const result: Infer<S>[] = [];
    for (let index = 0; index < input.length; index++) {
      try {
        result.push(parseAt(itemSchema, input[index], [...path, index]) as Infer<S>);
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        issues.push(...error.issues);
      }
    }
    if (issues.length > 0) throw new ValidationError(issues);
    return result;
  });
};

export const object = <S extends Shape>(
  shape: S,
  options: ObjectOptions = {},
): Schema<InferShape<S>> => {
  if (!['strip', 'strict', 'passthrough'].includes(options.unknownKeys ?? 'strip')) {
    throw new TypeError('unknownKeys must be strip, strict, or passthrough.');
  }
  return new Schema((input, path) => {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      fail('invalid_type', 'Expected an object.', path);
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      fail('invalid_prototype', 'Expected an object with a plain or null prototype.', path);
    }
    for (const key of Object.keys(shape)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        fail('unsafe_key', `Unsafe schema key "${key}" is not allowed.`, [...path, key]);
      }
    }
    const result: Record<string, unknown> = {};
    const issues: ValidationIssue[] = [];
    for (const key of Object.keys(shape)) {
      const schema = shape[key];
      if (!schema) continue;
      const hasKey = Object.prototype.hasOwnProperty.call(input, key);
      try {
        const parsed = parseAt(schema, hasKey ? Reflect.get(input, key) : undefined, [
          ...path,
          key,
        ]);
        if (hasKey || parsed !== undefined) {
          Object.defineProperty(result, key, {
            value: parsed,
            enumerable: true,
            configurable: true,
            writable: true,
          });
        }
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        issues.push(...error.issues);
      }
    }
    const mode = options.unknownKeys ?? 'strip';
    for (const key of Object.keys(input)) {
      if (Object.prototype.hasOwnProperty.call(shape, key)) continue;
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        issues.push({
          code: 'unsafe_key',
          message: `Unsafe object key "${key}" is not allowed.`,
          path: [...path, key],
        });
        continue;
      }
      if (mode === 'strict') {
        issues.push({
          code: 'unknown_key',
          message: `Unknown key "${key}".`,
          path: [...path, key],
        });
      }
      if (mode === 'passthrough') {
        Object.defineProperty(result, key, {
          value: Reflect.get(input, key),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    }
    if (issues.length > 0) throw new ValidationError(issues);
    return result as InferShape<S>;
  });
};

export const union = <const S extends readonly [Schema<unknown>, ...Schema<unknown>[]]>(
  schemas: S,
): Schema<Infer<S[number]>> => {
  if (schemas.length === 0) throw new RangeError('Union schemas cannot be empty.');
  return new Schema((input, path) => {
    const failures: ValidationIssue[][] = [];
    for (const schema of schemas) {
      try {
        return parseAt(schema, input, path) as Infer<S[number]>;
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        failures.push([...error.issues]);
      }
    }
    fail('invalid_union', 'Input did not match any union member.', path, failures.flat());
  });
};

function validateLengthBounds(min?: number, max?: number): void {
  if (
    (min !== undefined && (!Number.isInteger(min) || min < 0)) ||
    (max !== undefined && (!Number.isInteger(max) || max < 0)) ||
    (min !== undefined && max !== undefined && min > max)
  ) {
    throw new RangeError(
      'Length bounds must be non-negative integers and min must not exceed max.',
    );
  }
}

function testPattern(pattern: RegExp, value: string): boolean {
  return new RegExp(pattern.source, pattern.flags).test(value);
}

function formatPath(path: readonly PathSegment[]): string {
  return path.length === 0 ? '$' : `$.${path.map(String).join('.')}`;
}

function fail(
  code: string,
  message: string,
  path: readonly PathSegment[],
  nested?: readonly ValidationIssue[],
): never {
  const issue: ValidationIssue = { code, message, path: [...path] };
  throw new ValidationError(nested ? [issue, ...nested] : [issue]);
}

function parseAt<T>(schema: Schema<T>, input: unknown, path: readonly PathSegment[]): T {
  const parser = parsers.get(schema as Schema<unknown>);
  if (!parser) throw new TypeError('Invalid schema instance.');
  return parser(input, path) as T;
}
