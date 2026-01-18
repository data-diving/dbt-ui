# dbt-ui Backend Server

FastAPI backend server that provides file system access for the dbt-ui web application.

**Note**: Only git-based dbt projects are supported. The project must be a git repository.

## Features

- **Path Validation**: Verify dbt project paths and check for `dbt_project.yml`
- **Directory Listing**: List dbt project structure with lazy loading
- **File Reading**: Read SQL, YAML, and other text files
- **Git Operations**: Branch management, staging, committing, push/pull
- **CORS Enabled**: Allows requests from the frontend dev server

## Installation

```bash
# Create virtual environment
uv venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
uv pip install -r requirements.txt
```

## Running the Server

```bash
# Development mode with auto-reload
uv run uvicorn main:app --reload --port 8000

# Or using Python directly
python main.py
```

The server will start on `http://localhost:8000`

## API Endpoints

### `GET /`
Health check and API info

### `POST /api/validate-path`
Validate if a path is a valid dbt project
```json
{
  "path": "/path/to/dbt-project"
}
```

### `POST /api/list-directory-shallow`
Get directory contents (shallow, for lazy loading)
```json
{
  "path": "/path/to/dbt-project",
  "subPath": "models/staging"
}
```

### `POST /api/read-file`
Read file contents
```json
{
  "projectPath": "/path/to/dbt-project",
  "filePath": "models/staging/stg_orders.sql"
}
```

### `GET /health`
Server health check

## Security

- Files must be within the specified project directory
- Hidden files and sensitive directories are excluded
- Only text files with relevant extensions are accessible
- Path traversal attempts are blocked

## Docker Configuration

When running in Docker, the backend uses a volume mount (configured in `docker-compose.yml`):

| Mount Path | Environment Variable | Default | Description |
|------------|---------------------|---------|-------------|
| `/home/dbtui/git-repos` | `GIT_REPOS_PATH` | `./git-repos` | Git repositories (cloned from URLs or existing local repos) |

To use existing git repositories from your host machine:

```bash
GIT_REPOS_PATH=/path/to/your/repos docker-compose up --build
```

## API Documentation

Visit `http://localhost:8000/docs` for interactive API documentation (Swagger UI)
Visit `http://localhost:8000/redoc` for alternative documentation
