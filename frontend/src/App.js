"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
var react_1 = require("react");
require("./App.css");
var GitSetupDialog_1 = require("./components/git/GitSetupDialog");
var ProjectPathDialog_1 = require("./components/main/ProjectPathDialog");
var MainLayout_1 = require("./components/main/MainLayout");
var api_1 = require("./config/api");
var STORAGE_KEY = 'dbt-ui-project-path';
var GIT_CONFIG_KEY = 'dbt-ui-git-config';
var RECENT_PROJECTS_KEY = 'dbt-ui-recent-projects';
var MAX_RECENT_PROJECTS = 3;
function App() {
    var _this = this;
    var _a = (0, react_1.useState)(null), gitConfig = _a[0], setGitConfig = _a[1];
    var _b = (0, react_1.useState)(null), projectPath = _b[0], setProjectPath = _b[1];
    var _c = (0, react_1.useState)(''), dbtVersion = _c[0], setDbtVersion = _c[1];
    var _d = (0, react_1.useState)(true), isValidating = _d[0], setIsValidating = _d[1];
    var _e = (0, react_1.useState)(false), isEditingGitConfig = _e[0], setIsEditingGitConfig = _e[1];
    var _f = (0, react_1.useState)([]), recentProjects = _f[0], setRecentProjects = _f[1];
    // Load recent projects from localStorage
    var loadRecentProjects = function () {
        try {
            var stored = localStorage.getItem(RECENT_PROJECTS_KEY);
            if (stored) {
                return JSON.parse(stored);
            }
        }
        catch (e) {
            console.error('Failed to load recent projects:', e);
        }
        return [];
    };
    // Save a project to recent projects list
    var saveToRecentProjects = function (path, displayPath, projectName) {
        var projects = loadRecentProjects();
        // Use dbt project name if available, otherwise extract from displayPath
        var name = projectName;
        if (!name) {
            if (displayPath.includes('://') || displayPath.startsWith('git@')) {
                // Git URL - extract repo name
                var match = displayPath.match(/\/([^/]+?)(\.git)?$/);
                name = match ? match[1] : displayPath;
            }
            else {
                // Local path - use last segment
                name = displayPath.split('/').filter(Boolean).pop() || displayPath;
            }
        }
        // Remove if already exists (by worktree path)
        var filtered = projects.filter(function (p) { return p.path !== path; });
        // Add to front
        var updated = __spreadArray([
            { path: path, name: name, displayPath: displayPath, lastOpened: Date.now() }
        ], filtered, true).slice(0, MAX_RECENT_PROJECTS);
        try {
            localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(updated));
            setRecentProjects(updated);
        }
        catch (e) {
            console.error('Failed to save recent projects:', e);
        }
    };
    // Check for existing git config on mount
    (0, react_1.useEffect)(function () {
        try {
            var stored = localStorage.getItem(GIT_CONFIG_KEY);
            if (stored) {
                var config = JSON.parse(stored);
                if (config.userName && config.userEmail) {
                    setGitConfig(config);
                }
            }
        }
        catch (e) {
            console.error('Failed to load git config:', e);
        }
        // Load recent projects
        setRecentProjects(loadRecentProjects());
    }, []);
    // On mount, try to restore the last project path
    (0, react_1.useEffect)(function () {
        var restoreProject = function () { return __awaiter(_this, void 0, void 0, function () {
            var savedPath, response, _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        savedPath = localStorage.getItem(STORAGE_KEY);
                        if (!savedPath) return [3 /*break*/, 4];
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, (0, api_1.apiFetch)((0, api_1.apiUrl)('/api/validate-path'), {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ path: savedPath }),
                            })];
                    case 2:
                        response = _b.sent();
                        if (response.ok) {
                            setProjectPath(savedPath);
                        }
                        else {
                            // Path no longer valid, clear it
                            localStorage.removeItem(STORAGE_KEY);
                        }
                        return [3 /*break*/, 4];
                    case 3:
                        _a = _b.sent();
                        // Backend not available, clear saved path
                        localStorage.removeItem(STORAGE_KEY);
                        return [3 /*break*/, 4];
                    case 4:
                        setIsValidating(false);
                        return [2 /*return*/];
                }
            });
        }); };
        restoreProject();
    }, []);
    var handlePathSubmit = function (path, version, displayPath, projectName) {
        localStorage.setItem(STORAGE_KEY, path);
        saveToRecentProjects(path, displayPath, projectName);
        setProjectPath(path);
        setDbtVersion(version);
    };
    var handleChangeProject = function () {
        localStorage.removeItem(STORAGE_KEY);
        setProjectPath(null);
    };
    var handleGitSetupComplete = function (config) {
        setGitConfig(config);
        setIsEditingGitConfig(false);
    };
    var handleEditGitConfig = function () {
        setIsEditingGitConfig(true);
    };
    // Show nothing while validating saved path
    if (isValidating) {
        return <div className="app"/>;
    }
    // Show git setup dialog if not configured or if editing
    if (!gitConfig || isEditingGitConfig) {
        return (<div className="app">
        <GitSetupDialog_1.default onComplete={handleGitSetupComplete} initialConfig={gitConfig} isEditing={isEditingGitConfig}/>
      </div>);
    }
    return (<div className="app">
      {!projectPath ? (<ProjectPathDialog_1.default gitConfig={gitConfig} onSubmit={handlePathSubmit} onEditUser={handleEditGitConfig} recentProjects={recentProjects}/>) : (<MainLayout_1.default projectPath={projectPath} dbtVersion={dbtVersion} onChangeProject={handleChangeProject}/>)}
    </div>);
}
exports.default = App;
