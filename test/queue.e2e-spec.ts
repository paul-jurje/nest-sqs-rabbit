import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';

describe('QueueController (e2e)', () => {
  let app: INestApplication;
  let server: any;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    server = app.getHttpServer();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /queues/providers', () => {
    return request(server)
      .get('/queues/providers')
      .expect(200)
      .expect((res) => {
        expect(Array.isArray(res.body.providers)).toBe(true);
        expect(res.body.providers).toContain('memory');
        expect(res.body.activeProvider).toBeDefined();
      });
  });

  it('POST /queues/:provider/:queue/publish -> pull -> ack', async () => {
    const publishRes = await request(server)
      .post('/queues/memory/test-queue/publish')
      .send({ payload: { hello: 'world' } })
      .expect(201);

    const msg = publishRes.body;
    expect(msg).toBeDefined();
    expect(msg.payload).toBeDefined();
    expect(msg.payload.hello).toBe('world');
    expect(msg.receipt).toBeDefined();

    const pullRes = await request(server)
      .post('/queues/memory/test-queue/pull')
      .send({})
      .expect(201);

    expect(Array.isArray(pullRes.body)).toBe(true);
    expect(pullRes.body.length).toBeGreaterThanOrEqual(1);
    expect(pullRes.body[0].payload.hello).toBe('world');

    await request(server)
      .post('/queues/memory/test-queue/ack')
      .send({ receipt: msg.receipt })
      .expect(201);
  });
});
