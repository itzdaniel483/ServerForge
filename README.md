# ServerForge

<div align="center">

![ServerForge Banner](https://via.placeholder.com/800x200/111827/3b82f6?text=SERVER+FORGE)

**We are excited to announce the first official release of ServerForge, a modern, high-performance game server management panel**
Built for speed, security, and ease of use.

[Features](#features) • [Installation](#installation) • [Supported Games](#supported-games) • [Documentation](#documentation)

</div>

---

## 🚀 Features

- 🎮 **Multi-Game Support** - Native support for Source Engine, Rust, ARK, and more.
- ⚡ **Instant Deployment** - Smart pre-caching system for lightning-fast server installs.
- 🛡️ **Enterprise Security** - Cloudflare Zero Trust integration & role-based access control.
- 📊 **Real-Time Console** - Live server monitoring, logs, and player management.
- 📂 **Web File Manager** - Edit configuration files directly from your browser.
- 🔄 **Automated Backups** - Schedule backups to keep your data safe.
- 🔌 **Plugin System** - Extensible architecture for custom functionality.

## 🛠️ System Requirements

| Component | Requirement |
|-----------|-------------|
| **OS** | Windows 10/11, Linux (Ubuntu/Debian), or macOS |
| **Node.js** | **Version 18 or higher** (Required) |
| **RAM** | 4GB+ Recommended |
| **Disk** | 10GB+ (varies by game) |

---

## 📦 Installation

### 🪟 Windows (Quick Start)

1.  **Prerequisite:** Ensure **Node.js v18+** is installed. [Download here](https://nodejs.org/).
2.  **Download & Extract:** Unzip `ServerForge_v1.0.zip` to a folder of your choice (e.g., `C:\ServerForge`).
3.  **Run Installer:**
    *   Right-click the Start button and select **Terminal (Admin)** or **PowerShell (Admin)**.
    *   Navigate to your folder: `cd C:\ServerForge`
    *   Run this command to set up dependencies:
        ```powershell
        Set-ExecutionPolicy Bypass -Scope Process -Force; .\installers\windows\install.ps1
        ```
4.  **Start ServerForge:**
    *   Ensure you are in the root `ServerForge_v1.0` folder.
    *   Run:
        ```powershell
        npm start
        ```
5.  **Access the Panel:**
    *   Open your browser to: **`http://localhost:3000`**
    *   **Username:** `admin`
    *   **Password:** set `ADMIN_PASSWORD` before the first start, or read the random one from `backend/data/initial-admin-password`. Change it in Settings → Account.

> [!TIP]
> If you see an "Execution Policy" error, ensure you are running PowerShell as **Administrator**.

### 🐧 Linux / macOS

1.  **Run the installer:**
    ```bash
    chmod +x installers/linux/install.sh
    ./installers/linux/install.sh
    ```
2.  **Start the panel:**
    ```bash
    npm start
    ```

### 🐳 Docker (Recommended for Production)

Docker deployment provides easy multi-instance support and simplified deployment to platforms like Dokploy.

1.  **Setup environment:**
    ```bash
    copy .env.example .env
    ```
2.  **Build and run:**
    ```bash
    docker-compose up -d
    ```
2.  **Access the panel:** Open `http://localhost:3000`
    *   User: `admin`
    *   Password: `ADMIN_PASSWORD`, or the random one in `data/initial-admin-password`

**For detailed Docker deployment instructions**, including:
- Dokploy deployment
- Multi-instance setup
- Environment configuration
- Production best practices

See **[DOCKER.md](DOCKER.md)** for the complete guide.


## 🎮 Supported Games

ServerForge supports 16+ games out of the box, including:

*   **FPS:** CS:GO, CS:Source, TF2, L4D2, Insurgency
*   **Survival:** Rust, ARK: Survival Evolved, 7 Days to Die, The Forest, Project Zomboid
*   **Sandbox:** Garry's Mod
*   **Classic:** Half-Life 2: DM, Day of Defeat: Source

## 🔒 Authentication

ServerForge supports two authentication modes:

1.  **Local Auth (Default):** Standard username/password login.
2.  **External Auth:** Integration with **Cloudflare Zero Trust** for enterprise-grade security (SSO, MFA).

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the ISC License.
