import validation = require('@lp-labs/validation');

const schema = validation.object({ id: validation.number(), title: validation.string() });
const parsed = schema.parse({ id: 1, title: 'x' });
const id: number = parsed.id;
void id;
// @ts-expect-error inferred field type is number
const wrong: string = parsed.id;
void wrong;
