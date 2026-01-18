# dbt-ui Frontend

React + TypeScript web application for the dbt-ui project.

## Features

- **Project Browser**: Tree view of dbt project structure with file icons
- **Code Editor**: Monaco Editor with SQL and YAML syntax highlighting
- **Lineage Graph**: Interactive DAG visualization using ReactFlow
- **dbt Commands**: Run, test, compile, and seed operations
- **Environment Variables**: Manage `.dbt-ui-env` file for dbt commands

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
├── components/         # React components
│   ├── Editor.tsx      # Monaco code editor
│   ├── GraphView.tsx   # Lineage graph panel
│   ├── LineageGraph.tsx # ReactFlow DAG
│   ├── MainLayout.tsx  # Main app layout
│   ├── Sidebar.tsx     # File tree browser
│   └── ...
├── config/
│   └── api.ts          # API URL configuration
├── App.tsx             # Root component
├── main.tsx            # Entry point
└── App.css             # Global styles
```

## Configuration

Environment variables (optional):

- `VITE_API_URL` - Backend API URL (defaults to `http://localhost:8000`)

See `.env.example` for reference.
