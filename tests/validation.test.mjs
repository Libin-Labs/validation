import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Schema,
  ValidationError,
  array,
  boolean,
  enumeration,
  literal,
  number,
  object,
  string,
  union,
  unknown,
} from '../dist/esm/index.js';

test('validates primitives and finite numeric bounds', () => {
  assert.equal(string({ minLength: 2, maxLength: 4 }).parse('abc'), 'abc');
  assert.equal(number({ min: 1, max: 3, integer: true }).parse(2), 2);
  assert.equal(boolean().parse(false), false);
  assert.equal(literal(null).parse(null), null);
  assert.throws(() => literal(Infinity), RangeError);
  assert.equal(enumeration(['open', 'closed']).parse('open'), 'open');
  assert.equal(unknown().parse({ any: true }).any, true);
  for (const invalid of [NaN, Infinity, -Infinity, '2']) {
    assert.equal(number().safeParse(invalid).success, false);
  }
  assert.throws(() => string({ minLength: -1 }), RangeError);
  assert.throws(() => number({ min: 2, max: 1 }), RangeError);
  assert.throws(() => enumeration([]), RangeError);
  assert.throws(() => array(string(), { maxLength: 0, minLength: 1 }), RangeError);
  assert.throws(() => object({}, { unknownKeys: 'invalid' }), TypeError);
});

test('reports structured nested object and array paths', () => {
  const schema = object({
    user: object({ name: string({ minLength: 2 }) }),
    scores: array(number({ min: 0 })),
  });
  const result = schema.safeParse({ user: { name: '' }, scores: [1, -2] });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(
      result.error.issues.map((issue) => issue.path),
      [
        ['user', 'name'],
        ['scores', 1],
      ],
    );
    assert.deepEqual(
      result.error.issues.map((issue) => issue.code),
      ['too_small', 'too_small'],
    );
    assert.match(result.error.message, /\$\.user\.name/);
  }
  const sparse = array(number()).safeParse(new Array(1));
  assert.equal(sparse.success, false);
  if (!sparse.success) assert.deepEqual(sparse.error.issues[0]?.path, [0]);
});

test('optional nullable and inferred object fields preserve absent values', () => {
  const schema = object({
    required: string(),
    optional: number().optional(),
    nullable: string().nullable(),
  });
  assert.deepEqual(schema.parse({ required: 'yes', nullable: null }), {
    required: 'yes',
    nullable: null,
  });
});

test('strict and passthrough unknown-key modes work safely', () => {
  const base = { allowed: 'yes', extra: 4 };
  assert.deepEqual(object({ allowed: string() }).parse(base), { allowed: 'yes' });
  assert.equal(object({ allowed: string() }, { unknownKeys: 'passthrough' }).parse(base).extra, 4);
  const strict = object({ allowed: string() }, { unknownKeys: 'strict' }).safeParse(base);
  assert.equal(strict.success, false);
  if (!strict.success) assert.deepEqual(strict.error.issues[0]?.path, ['extra']);
});

test('rejects prototype-bearing inputs and prototype-polluting keys', () => {
  const schema = object({ value: string() }, { unknownKeys: 'passthrough' });
  assert.equal(
    schema.safeParse(
      new (class Input {
        value = 'x';
      })(),
    ).success,
    false,
  );
  const polluted = JSON.parse('{"value":"ok","__proto__":{"polluted":true}}');
  const result = schema.safeParse(polluted);
  assert.equal(result.success, false);
  assert.equal({}.polluted, undefined);
  assert.equal(object({}).safeParse(Object.create(null)).success, true);
});

test('union includes nested member issues and accepts a matching member', () => {
  const schema = union([string({ minLength: 3 }), number({ min: 10 })]);
  assert.equal(schema.parse(10), 10);
  const result = schema.safeParse(false);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.issues[0]?.code, 'invalid_union');
    assert.deepEqual(
      result.error.issues.slice(1).map((issue) => issue.code),
      ['invalid_type', 'invalid_type'],
    );
  }
});

test('refine adds custom issue and safeParse distinguishes failures', () => {
  const even = number().refine((value) => value % 2 === 0, 'Must be even.', 'not_even');
  assert.equal(even.parse(4), 4);
  const result = even.safeParse(3);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.issues[0]?.code, 'not_even');
    assert.deepEqual(result.error.issues[0]?.path, []);
  }
  assert.throws(() => even.parse(3), ValidationError);
});

test('custom schema receives a path and supports independent reusable parsing', () => {
  const nonEmpty = new Schema((input, path) => {
    if (typeof input !== 'string' || input.length === 0) {
      throw new ValidationError([{ code: 'non_empty', message: 'Expected text.', path }]);
    }
    return input;
  });
  const parsed = object({ value: nonEmpty }).safeParse({ value: '' });
  assert.equal(parsed.success, false);
  if (!parsed.success) assert.deepEqual(parsed.error.issues[0]?.path, ['value']);
});
