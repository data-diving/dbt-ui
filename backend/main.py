"""dbt-ui Backend API - Main application entry point."""
import os
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware

# Import routers
from routes.file_routes import router as file_router
from routes.git_routes import router as git_router
from routes.dbt_routes import router as dbt_router
from routes.venv_routes import router as venv_router
from routes.env_routes import router as env_router
from routes.metadv_routes import router as metadv_router
from auth import verify_credentials, is_auth_enabled

def is_metadv_enabled() -> bool:
    """Check if MetaDV feature is enabled via environment variable."""
    return os.environ.get("DBT_UI__METADV_ENABLED", "true").lower() in ("true", "1", "yes")

app = FastAPI(title="dbt-ui Backend API")

# Configure CORS - allow specific origins for credential support (cookies)
# When allow_credentials=True, allow_origins cannot be ["*"]
allowed_origins = [
    "http://localhost:5173",  # Vite dev server
    "http://localhost:3000",  # Alternative dev port
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
    "http://localhost:8080",  # Alternative port
    "http://127.0.0.1:8080",
    "http://localhost:80",    # Docker (nginx on port 80)
    "http://127.0.0.1:80",
    "http://localhost",       # Docker (port 80 implied)
    "http://127.0.0.1",
]

# Add custom frontend URL from environment variable if set
frontend_url = os.environ.get("DBT_UI__FRONTEND_URL")
if frontend_url and frontend_url not in allowed_origins:
    allowed_origins.append(frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers with authentication dependency if auth is enabled
auth_dependency = [Depends(verify_credentials)] if is_auth_enabled() else []

app.include_router(file_router, dependencies=auth_dependency)
app.include_router(git_router, dependencies=auth_dependency)
app.include_router(dbt_router, dependencies=auth_dependency)
app.include_router(venv_router, dependencies=auth_dependency)
app.include_router(env_router, dependencies=auth_dependency)

# Only include MetaDV router if the feature is enabled
if is_metadv_enabled():
    app.include_router(metadv_router, dependencies=auth_dependency)


@app.get("/")
async def root():
    return {"message": "dbt-ui Backend API", "version": "0.1.0"}


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
