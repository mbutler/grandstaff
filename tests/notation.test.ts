import { expect, test } from 'bun:test';
import { noteValue } from '../src/count/notation';
test('standard note values match their heads, stems and flag counts', () => {
  expect(noteValue(8)).toEqual({hollow:true, stem:false, flags:0, dotted:false});
  expect(noteValue(4)).toEqual({hollow:true, stem:true, flags:0, dotted:false});
  expect(noteValue(2)).toEqual({hollow:false, stem:true, flags:0, dotted:false});
  for (const [cells, flags] of [[1,1],[.5,2],[.25,3],[.125,4]]) expect(noteValue(cells!).flags).toBe(flags!);
  expect(noteValue(3)).toEqual({hollow:false, stem:true, flags:0, dotted:true});
  expect(noteValue(6)).toEqual({hollow:true, stem:true, flags:0, dotted:true});
  expect(() => noteValue(5)).toThrow();
});
