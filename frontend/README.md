# dbt-ui Frontend

React + TypeScript web application for the dbt-ui project.

## Features

- **Project Browser**: Tree view of dbt project structure with file icons
- **Code Editor**: Monaco Editor with SQL and YAML syntax highlighting
- **Lineage Graph**: Interactive DAG visualization using ReactFlow
- **dbt Commands**: Run, test, compile, and seed operations
- **Environment Variables**: Set values for the project's `env_var()` calls (kept per project in a browser cookie)

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

The dev server will start on `http://localhost:5173`

## Build

```bash
npm run build
```

Output will be in the `dist/` folder.

## Type Checking

```bash
npm run typecheck
```

## Linting

```bash
npm run lint
```

## Project Structure

```
src/
├── components/
│   ├── main/           # Layout, project dialog, sidebar (file tree), shared modals
│   ├── editor/         # Monaco editor, data preview, lineage graph, properties panel
│   ├── dbt/            # dbt run results and env vars dialogs
│   ├── git/            # Git dialog, credentials and identity setup
│   ├── metadv/         # MetaDV (Data Vault) dialog
│   └── scheduler/      # Scheduler: jobs, runs, timeline, settings
├── config/
│   └── api.ts          # API URL, auth and user headers
├── App.tsx             # Root component
├── main.tsx            # Entry point
└── App.css             # Global styles
```

## Configuration

Environment variables (optional):

- `VITE_API_URL` - Backend API URL (defaults to `http://localhost:8000`)

See `.env.example` for reference.
