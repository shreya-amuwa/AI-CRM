---
title: How to Provision and Manage HR Department Accounts
summary: Operational and technical guide to create and configure HR staff accounts using both the CRM web interface and the automated CLI script.
audience: internal
roles:
  - Super Admin
  - HR Manager
related:
  - /hr/hr-operations-directory
  - /super-admin/staff-and-role-administration
  - /getting-started/signing-in
---

# How to Provision and Manage HR Department Accounts

The HR Department (`departments.slug = 'hr'`) operates with dedicated access controls to maintain employee confidentiality, oversee attendance registers, and approve corporate leave requests.

Accounts for HR personnel can be provisioned through two verified methods:
1. **Via Web Interface:** Through the Super Admin or HR Department Head interface.
2. **Via Automated CLI Script:** Using the verified `create-hr-login.mjs` maintenance script.

---

## Method 1: Web Interface Provisioning

### Prerequisites
- You must be authenticated as an active **Super Admin** or existing **HR Department Head**.

### Step-by-Step Procedure
1. Open the **HR Department Panel** at `/departments/hr`.
2. Navigate to the **Staff Management / Access Control** sub-tab.
3. Click **Add HR Member**.
4. Complete the required fields:
   - **Full Name:** E.g., *"Meera Sundaram"*.
   - **Work Email:** E.g., `meera.hr@amuwa.com`.
   - **Role:** Select `DEPARTMENT_HEAD` (Head of HR) or `TEAM_HEAD` / `TEAM_MEMBER` (HR Executive).
   - **Password:** Minimum 10 characters (or click *Generate*).
5. Click **Create Member**.
6. The system maps the user to the `hr` department with the appropriate administrative privileges.

---

## Method 2: CLI Maintenance Script Provisioning

For initial system setup, automated deployment, or disaster recovery, the repository includes a standalone script: `scripts/create-hr-login.mjs`.

### Command Syntax

```bash
# Ensure standard database environment variables are set in your execution environment
npm run create:hr-login -- --email <login-email> --name "<Full Name>" --super-admin <super-admin-email> [--role <ROLE>] [--generate]
```

### Parameter Reference

| Flag | Description | Default |
| :--- | :--- | :--- |
| `--email` | The corporate email for the new HR login. (Mandatory) | None |
| `--name` | Full legal name of the HR specialist. | `"HR Manager"` |
| `--super-admin` | Email of an active Super Admin on whose behalf the account is created. (Mandatory) | None |
| `--role` | Role tier: `DEPARTMENT_HEAD`, `TEAM_HEAD`, or `TEAM_MEMBER`. | `DEPARTMENT_HEAD` |
| `--generate` | Generates a 16-character secure random password and prints it once. | Optional |

### Example Execution

```bash
npm run create:hr-login -- \
  --email hr.operations@amuwa.com \
  --name "Pooja Krishnan" \
  --super-admin admin@amuwa.com \
  --role DEPARTMENT_HEAD \
  --generate
```

### Script Execution Logic

The script performs the following atomic validations:
1. Validates standard database environment configuration.
2. Checks that the `--super-admin` email corresponds to an active `SUPER_ADMIN` profile.
3. Resolves the corporate HR department record (`slug = 'hr'`).
4. Creates the authenticated user in Supabase Auth (`auth.users`).
5. Inserts the user profile into `public.profiles` with department ID and designated role.
6. Prints the single-use credentials for secure transmission to the employee.

---

## Logging In as HR

Once provisioned:
1. The HR specialist navigates to the CRM login portal at `/login`.
2. Enters their registered HR email and password.
3. The CRM router evaluates their role mapping and directs them directly to the **HR Department Workspace** (`/departments/hr`).
