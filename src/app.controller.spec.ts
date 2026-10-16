import { AppController } from './app.controller.js';

describe('AppController', () => {
  it('reports ok on /health', () => {
    expect(new AppController().health()).toEqual({ status: 'ok' });
  });
});
