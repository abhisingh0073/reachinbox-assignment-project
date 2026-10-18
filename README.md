# ReachInbox — Email Job Scheduler

A full-stack email scheduling system that accepts email requests, schedules them for future delivery, and processes them asynchronously using BullMQ and Redis. The application provides a web dashboard for scheduling email campaigns, importing contacts, and monitoring email job statuses.

Email sending is tested using Ethereal Email, a fake SMTP service that provides browser-based previews instead of delivering messages to real inboxes.

## Features

- **Email scheduling:** Schedule email jobs for a specified date and time.
- **Contact import:** Upload CSV and Excel files (`.csv`, `.xlsx`, `.xls`).
- **Contact preview:** Review contact names, email addresses, branches, applications, and offers before scheduling.
- **Duplicate detection:** Skip duplicate email addresses during import.
- **Email validation:** Reject invalid email addresses.
- **Background processing:** Process scheduled jobs through BullMQ workers.
- **Persistent job queue:** Use Redis with BullMQ to retain queued and delayed jobs across application restarts, subject to the configured persistence settings.
- **Database storage:** Store email job information and statuses in PostgreSQL.
- **Sending controls:** Configure hourly sending limits and delays between emails.
- **Job monitoring:** View scheduled email jobs and their processing attempts.
- **Email previews:** Inspect test emails using Ethereal preview links.
- **Search integration:** Use Elasticsearch for email job search and indexing.
- **Containerized infrastructure:** Run PostgreSQL, Redis, and Elasticsearch using Docker Compose.

## Tech Stack

| Component           | Technology                         |
| ------------------- | ---------------------------------- |
| Frontend            | Next.js, React, TypeScript         |
| Backend             | Node.js, Express, TypeScript       |
| Background jobs     | BullMQ                             |
| Queue storage       | Redis                              |
| Database            | PostgreSQL                         |
| ORM                 | Prisma                             |
| Email transport     | Nodemailer, Ethereal Email         |
| Search and indexing | Elasticsearch                      |
| CSV parsing         | Papa Parse / backend CSV utilities |
| Excel parsing       | SheetJS (`xlsx`)                   |
| Infrastructure      | Docker Compose                     |

## Architecture

```
                  ┌─────────────────────┐
                  │   Next.js Frontend  │
                  │  Contact Import UI  │
                  │  Scheduling Dashboard│
                  └──────────┬──────────┘
                             │ HTTP
                             ▼
                  ┌─────────────────────┐
                  │    Express API      │
                  │ Validation & Jobs   │
                  └──────┬──────┬───────┘
                         │      │
                 ┌───────▼──┐ ┌─▼────────────┐
                 │PostgreSQL│ │ Redis/BullMQ │
                 │ Job Data │ │ Delayed Jobs │
                 └──────────┘ └──────┬──────┘
                                     │
                                     ▼
                           ┌──────────────────┐
                           │ Background Worker│
                           └────────┬─────────┘
                                    │ SMTP
                                    ▼
                           ┌──────────────────┐
                           │  Ethereal Email  │
                           │   Test Previews  │
                           └──────────────────┘

                    Elasticsearch
                 Email job search/indexing
```

## Prerequisites

Install the following:

- Node.js and npm
- Git
- Docker Desktop with Docker Compose

The project was developed and tested in a Windows environment.

## Project Structure

```
reachinbox-assignment/
├── backend/
│   ├── prisma/
│   ├── src/
│   │   ├── server.ts
│   │   └── worker.ts
│   ├── package.json
│   └── .env
├── frontend/
│   ├── src/
│   ├── package.json
│   └── .env.local
├── docker-compose.yml
└── README.md
```

## Installation and Setup

### 1. Clone the repository

```
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd reachinbox-assignment
```

### 2. Start infrastructure services

From the project root, run:

```
docker compose up -d
```

Check container status:

```
docker compose ps
```

The Compose configuration provides the following services:

| Service       | Container port | Host port |
| ------------- | -------------- | --------- |
| PostgreSQL    | 5432           | 5433      |
| Redis         | 6379           | 6379      |
| Elasticsearch | 9200           | 9200      |

PostgreSQL data, Redis data, and Elasticsearch data use Docker volumes.

### 3. Configure backend environment variables

Create `backend/.env` and configure the variables required by the backend.

| Variable                 | Purpose                                                    |
| ------------------------ | ---------------------------------------------------------- |
| `DATABASE_URL`           | PostgreSQL connection string                               |
| `REDIS_HOST`             | Redis hostname                                             |
| `REDIS_PORT`             | Redis port                                                 |
| `PORT`                   | Backend API port                                           |
| `WORKER_CONCURRENCY`     | Worker concurrency setting                                 |
| `MIN_DELAY_MS`           | Minimum delay between email operations                     |
| `ETHEREAL_USER`          | Ethereal SMTP username                                     |
| `ETHEREAL_PASS`          | Ethereal SMTP password                                     |
| `ELASTICSEARCH_URL`      | Elasticsearch connection URL                               |
| `FRONTEND_URL`           | Frontend origin                                            |
| `APP_BASE_URL`           | Application base URL                                       |
| `SESSION_SECRET`         | Session signing secret                                     |
| `GOOGLE_CLIENT_ID`       | Google OAuth client ID, if OAuth is enabled                |
| `GOOGLE_CLIENT_SECRET`   | Google OAuth client secret, if OAuth is enabled            |
| `GOOGLE_CALLBACK_URL`    | Google OAuth callback URL, if OAuth is enabled             |
| `SLACK_CLIENT_ID`        | Slack OAuth client ID, if Slack integration is enabled     |
| `SLACK_CLIENT_SECRET`    | Slack OAuth client secret, if Slack integration is enabled |
| `SLACK_REDIRECT_URI`     | Slack OAuth redirect URL                                   |
| `SLACK_ALERT_CHANNEL_ID` | Slack alert destination                                    |

Use the values appropriate for your local environment. Optional integrations require their corresponding credentials and configuration.

**Security:** Never commit real credentials or secrets. Keep `backend/.env` and `frontend/.env.local` out of version control.

### 4. Install backend dependencies

Open PowerShell in the project root:

```
cd backend
npm install
```

Return to the project root when finished:

```
cd ..
```

### 5. Configure the frontend

Create or update `frontend/.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:3456
```

This URL assumes the backend API runs on port `3456`.

Install frontend dependencies:

```
cd frontend
npm install
```

### 6. Start the backend API

Open a PowerShell terminal in the backend directory:

```
npm run dev:api
```

The development API is configured to use port `3456` in the local setup.

Check the health endpoint from another terminal:

```
Invoke-RestMethod http://localhost:3456/health
```

Confirm that the API is running and its database connection is healthy.

### 7. Start the background worker

Open a separate PowerShell terminal:

```
cd path\to\reachinbox-assignment\backend
npm run dev:worker
```

Alternatively, open the terminal directly in the backend directory before running the command.

The worker processes jobs from the BullMQ queue when they become due.

### 8. Start the frontend

Open another PowerShell terminal:

```
cd path\to\reachinbox-assignment\frontend
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

Keep the API, worker, and infrastructure services running while testing the application.

## Using the Application

1. Open the frontend dashboard.
2. Upload a CSV or Excel contact file.
3. Review the contact preview and import summary.
4. Enter the email subject and message body.
5. Choose the scheduled date and time.
6. Configure the available sending limits and delay.
7. Submit the scheduling request.
8. Monitor the job's status and processing attempts.
9. Open the Ethereal preview link to inspect the test email.

### Supported contact columns

| Column         | Description                     |
| -------------- | ------------------------------- |
| `Name`         | Contact name                    |
| `Email`        | Recipient email address         |
| `Branch`       | Branch or department            |
| `Applications` | Application-related information |
| `Offers`       | Offer-related information       |

The email column is required. The importer also recognizes `Recipient` and `Email Address` as email column names.

Duplicate email addresses are detected without regard to letter case. Invalid email addresses are excluded from the valid recipient list.

## Email Testing

The project uses Ethereal Email for SMTP testing.

Ethereal captures outgoing test messages and generates preview links. It does **not** deliver these emails to real recipient inboxes.

A successful SMTP operation means the test SMTP server accepted the message; it does not establish real-world inbox delivery.

For production use, configure a real email provider and the appropriate sender-domain authentication.

## Background Job Reliability

BullMQ and Redis manage delayed jobs and background processing without cron jobs.

PostgreSQL stores application job data, while Redis stores queue state. Docker volumes help preserve service data across container recreation.

To verify restart behavior:

1. Schedule an email for a future time.
2. Confirm the job is queued.
3. Restart the API and worker.
4. Confirm the job remains scheduled.
5. Verify that the worker processes it when the scheduled time arrives.

Actual durability depends on Redis persistence, queue configuration, and correct job-state handling.

## Troubleshooting

### PostgreSQL connection errors

- Confirm the PostgreSQL container is running.
- Check `DATABASE_URL`.
- Verify the database credentials and host port.
- Ensure the backend connection settings match the Docker Compose configuration.

### Redis or queue errors

- Confirm Redis is running on the configured host and port.
- Check the API and worker logs.
- Verify the Redis connection settings.

### Jobs are not processed

- Confirm the worker is running.
- Verify that the scheduled time has arrived.
- Check the job status and worker logs.
- Inspect Redis connectivity and queue configuration.

### Email preview is unavailable

- Check the worker's SMTP logs.
- Verify the Ethereal credentials.
- Confirm that the job was processed successfully and a preview URL was generated.

### Frontend cannot reach the backend

- Confirm the API is running on port `3456`.
- Check `NEXT_PUBLIC_API_URL`.
- Inspect browser developer tools for network errors.

## Future Improvements

- Production SMTP provider integration
- Campaign analytics and reporting
- Email templates and personalization
- Enhanced retry and dead-letter handling
- Delivery tracking through provider webhooks
- Authentication and user-specific campaign management

## License

Developed as a full-stack email scheduling assignment. Specify a license if the project is distributed under an open-source license.

## Final checks before pushing to GitHub

Run these commands from the project root:

```
git status --short
```
=======
# reachinbox-assignment-project
>>>>>>> 0b60e99be3177e9f72fdc9ca4dc4f03c9dcea199
