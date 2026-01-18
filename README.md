# dbt UI

A modern web-based user interface for dbt-core projects.

<img width="3316" height="2316" alt="CleanShot 2026-01-18 at 22 21 32@2x" src="https://github.com/user-attachments/assets/9208b7b1-2cc1-4d1e-bdbf-22a069397656" />


## Quick Start with Docker

The easiest way to run dbt UI is using Docker:

```bash
# Clone the repository
git clone https://github.com/data-diving/dbt-ui.git
cd dbt-ui

# Run with Docker Compose
docker-compose up --build

# Or use existing git repositories from your computer
GIT_REPOS_PATH=/path/to/your/repos docker-compose up --build
```

### Volume Mount

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `GIT_REPOS_PATH` | `./git-repos` | Mount for git repositories - both cloned from URLs and existing local repos |

Set `GIT_REPOS_PATH` to point to your existing repos folder to work with local repositories.

Open your browser and navigate to `http://localhost`

The backend API is available at `http://localhost:8000`

## Architecture

This application consists of two parts:
- **Frontend**: React + TypeScript web application (Vite) - served via nginx
- **Backend**: FastAPI Python server for file system operations

## Features

- **Project Browser**: Browse your dbt project structure with an intuitive tree view
- **Code Editor**: Edit SQL models, YML configurations, tests, and macros with Monaco Editor
- **Lineage Graph**: Visualize model dependencies and data lineage
- **Quick Actions**: Run dbt commands, compile models, and manage your project
- **Local File Access**: No file uploads - backend reads files directly from your filesystem
- **Git Integration**: View modified files, stage changes, commit, push/pull, and switch branches
- **MetaDV**: Visual Data Vault modeling - map source columns to entities and generate Data Vault 2.0 models using [metadv](https://pypi.org/project/metadv/) package

**Note**: Only git-based dbt projects are supported. The project must be a git repository.

## Project Structure

```
dbt-ui/
├── frontend/           # React frontend application
├── backend/            # FastAPI backend server
├── docker/             # Docker configuration
├── docker-compose.yml
└── README.md
```

## License and Attribution

This project is licensed under the [MIT License](LICENSE).

## Third-Party Software

This project uses open-source libraries under various permissive licenses (MIT, Apache-2.0, BSD-3-Clause, ISC).

When you install dependencies via `npm install` and `pip install` or build a Docker image their license files are placed in:
- **Frontend**: `node_modules/` (view with `npm ls`)
- **Backend**: Python site-packages (view with `pip list`)

For license texts and copyright information, check each package's GitHub repository

#### Frontend (npm)

| Package | License | Version | Repository |
|---------|---------|---------|------------|
| @monaco-editor/react | MIT | ^4.7.0 | https://github.com/suren-atoyan/monaco-react |
| dagre | MIT | ^0.8.5 | https://github.com/dagrejs/dagre |
| lucide-react | ISC | ^0.294.0 | https://github.com/lucide-icons/lucide |
| react | MIT | ^18.2.0 | https://github.com/facebook/react |
| react-dom | MIT | ^18.2.0 | https://github.com/facebook/react |
| react-split-pane | MIT | ^3.0.4 | https://github.com/tomkp/react-split-pane |
| reactflow | MIT | ^11.11.4 | https://github.com/xyflow/xyflow |
| typescript | Apache-2.0 | ^5.2.2 | https://github.com/microsoft/TypeScript |
| vite | MIT | ^5.0.8 | https://github.com/vitejs/vite |
| eslint | MIT | ^8.55.0 | https://github.com/eslint/eslint |

#### Backend (PyPI)

| Package | License | Version | Repository |
|---------|---------|---------|------------|
| fastapi | MIT | 0.109.0 | https://github.com/tiangolo/fastapi |
| uvicorn | BSD-3-Clause | 0.27.0 | https://github.com/encode/uvicorn |
| pydantic | MIT | 2.5.3 | https://github.com/pydantic/pydantic |
| python-multipart | Apache-2.0 | 0.0.6 | https://github.com/Kludex/python-multipart |
| pyyaml | MIT | >=6.0 | https://github.com/yaml/pyyaml |
| packaging | Apache-2.0 | >=23.0 | https://github.com/pypa/packaging |

## Trademarks

- **dbt**, **dbt Core**, and **dbt Labs** are trademarks of [dbt Labs, Inc.](https://www.getdbt.com/)
- **Docker** and the Docker logo are trademarks or registered trademarks of [Docker, Inc.](https://www.docker.com/)

This project is not affiliated with, endorsed by, or sponsored by dbt Labs, Inc. or Docker, Inc.
