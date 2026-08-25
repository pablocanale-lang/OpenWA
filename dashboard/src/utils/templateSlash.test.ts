import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTemplateAtSlash,
  composeTemplateText,
  filterTemplatesBySlash,
  insertTemplateText,
  slashQueryAt,
} from './templateSlash.ts';
import type { MessageTemplate } from '../services/api.ts';

function tpl(name: string, body = `${name} body`): MessageTemplate {
  return {
    id: name,
    sessionId: 's',
    name,
    body,
    createdAt: '',
    updatedAt: '',
  };
}

test('composeTemplateText joins header, body and footer like send-template', () => {
  assert.equal(composeTemplateText({ body: 'Hola' }), 'Hola');
  assert.equal(composeTemplateText({ header: 'Kampro', body: 'Precio 150.000', footer: 'Gracias' }), 'Kampro\n\nPrecio 150.000\n\nGracias');
});

test('slashQueryAt picks /precio at the start and after a space, not inside https://', () => {
  assert.deepEqual(slashQueryAt('/pre', 4), { start: 0, query: 'pre' });
  assert.deepEqual(slashQueryAt('hola /pre', 9), { start: 5, query: 'pre' });
  assert.equal(slashQueryAt('https://', 8), null);
  assert.equal(slashQueryAt('ver precio', 10), null);
});

test('filterTemplatesBySlash ranks prefix matches first', () => {
  const list = [tpl('imagen'), tpl('precio'), tpl('precios-mayorista')];
  assert.deepEqual(
    filterTemplatesBySlash(list, 'precio').map(t => t.name),
    ['precio', 'precios-mayorista'],
  );
  assert.equal(filterTemplatesBySlash(list, 'xyz').length, 0);
});

test('applyTemplateAtSlash replaces the /token at the caret', () => {
  const result = applyTemplateAtSlash('hola /pre', 9, 'Lista de precios');
  assert.deepEqual(result, { text: 'hola Lista de precios', cursor: 21 });
});

test('insertTemplateText appends when there is no slash token', () => {
  const result = insertTemplateText('Ya hablamos', 11, 'El precio es 150.000 Gs');
  assert.equal(result.text, 'Ya hablamos\n\nEl precio es 150.000 Gs');
});
