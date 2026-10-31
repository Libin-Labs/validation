import { array, enumeration, number, object, string, type Infer } from '@lp-labs/validation';

const schema = object({
  id: number({ integer: true }),
  label: string(),
  state: enumeration(['ready', 'waiting']),
  note: string().optional(),
  values: array(number()),
});
type RecordType = Infer<typeof schema>;
const record: RecordType = {
  id: 1,
  label: 'one',
  state: 'ready',
  values: [1, 2],
};
void record;
// @ts-expect-error inferred enum is constrained
const invalid: RecordType = { id: 1, label: 'one', state: 'done', values: [] };
void invalid;
