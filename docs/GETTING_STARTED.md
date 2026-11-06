# Development setup

## Requirements

- Node.js 22.12 or later, with npm
- Git
- Your own Firebase project for sign-in
- Accounts and access rights for the AI, email and calendar services you plan to use

This repository contains the source for the web interface, the desktop integration layer and the work logic. It does not include runtimes such as Node.js, Python or external CLIs, or any paid service accounts.

## Install

```sh
git clone https://github.com/Ming-gu1021/modycrew-public.git
cd modycrew-public
npm ci
npm ci --prefix apps/modycrew-web
```

Copy `apps/modycrew-web/.env.example` to `.env.local` in the same folder and fill in the values from your Firebase project. In Firebase Authentication, enable the sign-in methods you want and add your development address to the authorized domains. If you use the database and file storage, apply the Firestore and Storage rules in this repository to your project and review the access permissions.

Do not commit real passwords, API keys or service account files to Git. Add AI models and external services from the app's connection settings. Connection options and available models depend on the permissions of each provider account.

## Web development

```sh
npm run dev
```

Open the local address shown in the terminal. Desktop-only features, such as working with files and launching programs, are not available in the browser.

## Desktop app

```sh
npm run build
npm run desktop:start
```

When run from source, the app keeps a separate profile in `.modycrew-source` under your home folder. To use another location, set the `MODYCREW_SOURCE_PROFILE` environment variable. Automatic updates are turned off when you run from source.

Some features, such as documents, coding and video, need additional runtimes or service connections. Check the connection status and permissions shown in the app before you use them.

## Checks

```sh
npm run build:domain
npm run typecheck
```

Keep the main process's checks on file access and program execution, along with the approval steps. When you change how files are opened, email is sent or calendar events are added, test with temporary data and your own test accounts.

## Running your own deployment

Use projects that you own for authentication, the database, storage and OAuth settings. This source release does not include Mody's production accounts or access to its services. If you run the public webhook relay, set `MODY_PUBLIC_RELAY_SIGNING_SECRET` and `MODY_PUBLIC_RELAY_PULL_TOKEN`; the relay does not work until both are set.

Code signing, installers and an update server for distribution need their own setup. Regular users can download the app from the [official download page](https://mody.ai.kr/modycrew#desktop-downloads).
