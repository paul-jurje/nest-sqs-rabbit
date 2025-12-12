<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

Nest-based message API with pluggable queue backends supporting both pull-based and subscription-based message consumption. Supports memory (default), SQS, and RabbitMQ providers.
- Small demo UI avaulable in the /public folder and at localhost:3000
## Queue API (publish/subscribe over REST)

- Provider selection: `QUEUE_PROVIDER=memory|sqs|rabbitmq` (defaults to memory for local/dev and 2FA-friendly fast TTL handling).
- Endpoints
  - `GET /queues/provider` – returns the active provider.
  - `POST /:provider/queues/:queue/publish` – body: `{ payload, delaySeconds?, ttlSeconds?, correlationId?, attributes? }`.
  - `POST /:provider/queues/:queue/pull` – body: `{ maxMessages? }` (defaults to 1). Returns messages with receipts.
  - `POST /:provider/queues/:queue/ack` – body: `{ receipt }` to remove a message after handling.


## Features

- **Pull-based consumption**: Actively fetch messages from queues
- **Subscription-based consumption**: Continuously listen and consume messages from queues with automatic processing
- **Multiple providers**: Support for in-memory, AWS SQS, and RabbitMQ
- **Message acknowledgment**: Manual or automatic acknowledgment of processed messages
- **Message attributes**: Support for custom attributes and correlation IDs

## Run locally

### Memory Driver (Default)

```bash
npm install
npm run start:dev
```

The API will run on `localhost:3000` with the in-memory queue driver (no external dependencies).

### With Docker Compose

Prereqs: Docker + docker compose.

#### Option 1: SQS (LocalStack)

```bash
QUEUE_PROVIDER=sqs docker-compose --profile sqs up --build
```

This starts:
- `localstack` on `localhost:4566` (SQS emulation)
- `api` on `localhost:3000` with `QUEUE_PROVIDER=sqs` configured to use LocalStack

#### Option 2: RabbitMQ

```bash
QUEUE_PROVIDER=rabbitmq docker-compose --profile rabbitmq up --build
```

This starts:
- `rabbitmq` on `localhost:5672` (AMQP) and `localhost:15672` (Management UI)
- `api` on `localhost:3000` with `QUEUE_PROVIDER=rabbitmq` configured to use RabbitMQ

**RabbitMQ Management UI**: Access at http://localhost:15672 (default credentials: `guest`/`guest`)

#### Option 3: All Services

```bash
QUEUE_PROVIDER=memory docker-compose --profile sqs --profile rabbitmq up --build
```

## Environment Variables

### Queue Provider Selection
- `QUEUE_PROVIDER` - Set to `memory`, `sqs`, or `rabbitmq` (default: `memory`)

### SQS Configuration
- `QUEUE_SQS_ENDPOINT` - SQS endpoint URL (e.g., `http://localstack:4566` for LocalStack)
- `AWS_REGION` - AWS region (default: `us-east-1`)
- `AWS_ACCESS_KEY_ID` - AWS access key ID
- `AWS_SECRET_ACCESS_KEY` - AWS secret access key

### RabbitMQ Configuration
- `QUEUE_RABBITMQ_URL` - Full AMQP URL (overrides individual settings if provided)
- `QUEUE_RABBITMQ_HOSTNAME` - RabbitMQ hostname (default: `localhost`)
- `QUEUE_RABBITMQ_PORT` - RabbitMQ port (default: `5672`)
- `QUEUE_RABBITMQ_USERNAME` - RabbitMQ username (default: `guest`)
- `QUEUE_RABBITMQ_PASSWORD` - RabbitMQ password (default: `guest`)
- `QUEUE_RABBITMQ_VHOST` - RabbitMQ virtual host (default: `/`)

## Quick test (publish/pull/ack)

```bash
# publish
curl -X POST http://localhost:3000/queues/login-otp/publish \
  -H "Content-Type: application/json" \
  -d '{"payload":{"code":"123456"},"ttlSeconds":300,"correlationId":"user-123"}'

# pull
curl -X POST http://localhost:3000/queues/login-otp/pull \
  -H "Content-Type: application/json" \
  -d '{"maxMessages":1}'

# ack (replace RECEIPT from pull response)
curl -X POST http://localhost:3000/queues/login-otp/ack \
  -H "Content-Type: application/json" \
  -d '{"receipt":"RECEIPT"}'
```

## Programmatic Usage (Subscription)

The queue service also supports programmatic subscription for continuous message consumption:

```typescript
import { QueueService } from './queue/queue.service';

// Subscribe to a queue
const subscription = await queueService.subscribe(
  'my-queue',
  async (message) => {
    console.log('Received message:', message.payload);
    console.log('Correlation ID:', message.correlationId);
    
    // Process the message...
    
    // Manually acknowledge (if autoAck is false)
    await queueService.ack('my-queue', message.receipt);
  },
  {
    maxMessages: 1,        // Messages per poll (for SQS/memory)
    pollIntervalMs: 1000,  // Poll interval in ms (for SQS/memory)
    autoAck: false,        // Auto-acknowledge messages
  }
);

// Later, unsubscribe
await subscription.unsubscribe();
```

**Note**: 
- For RabbitMQ, `pollIntervalMs` is ignored as it uses native consumer callbacks
- For SQS and memory drivers, messages are polled at the specified interval
- Set `autoAck: true` to automatically acknowledge messages after handler execution

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
