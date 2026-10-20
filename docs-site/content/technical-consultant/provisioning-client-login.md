---
title: How to Provision Client Portal Login Credentials
summary: Instructions for Technical Consultants to generate, configure, and issue secure client portal credentials for onboarding customers.
audience: internal
roles:
  - Technical Consultant
  - Support Team Lead
  - Accounts Department
related:
  - /technical-consultant/department-handover-tc
  - /technical-consultant/onboarding-queue
  - /client/welcome-client-portal
---

# How to Provision Client Portal Login Credentials

Every onboarding customer requiring access to the client portal (`/client/login`) must have an authenticated user account provisioned. For services following the Technical Consultant journey, the consultant provisions this account within the **Customer Verification Workspace**.

---

## Prerequisites

- You must be authenticated as a **Technical Consultant**.
- The customer must be open in the **Customer Verification Workspace**.
- The customer card must not be locked in a returned status (`WAITING_ON_SALES`).
- For standard onboarding, client credentials should be provisioned after business verification documents have been authorized.

---

## The Client Panel Login Component

In the right-hand panel of the customer workspace, locate the **Client panel login** card:

- **Icon:** Blue key badge (`KeyRound`).
- **Heading:** `Client panel login`
- **Description:** *"The e-mail and password the client uses to sign in to their customer dashboard (/client/login) and the app. Use the same ones you set in the internal platform."*

---

## Step-by-Step Procedure

### 1. Verify the Client Email Address

1. Inspect the pre-filled **Client e-mail (login)** field.
2. The system defaults to the primary email entered during sales lead intake.
3. If the customer requested a different administrative email for dashboard access, update the field accordingly.
4. Ensure the email is in valid format and contains no trailing spaces.

---

### 2. Set or Generate a Secure Password

1. Enter a password in the **Password (min. 10 characters)** field.
2. Alternatively, click the **Generate** button:
   - The generator creates a high-entropy, 14-character alphanumeric string including special characters (e.g., `K9#mQ2$pL8vX!w`).
   - The password automatically unmasks for immediate review.
3. You can toggle the eye icon to show or hide the password characters.

---

### 3. Create the Account

1. Click the blue **Create client login** button.
2. The system calls Supabase Auth and updates the `client_accounts` mapping:
   - Validates that the email is not already registered to another active portal tenant.
   - Creates the user in Supabase Authentication with the `client` role.
   - Links the auth record directly to `customers.id`.

---

### 4. Copy and Secure Credentials

Once created, an amber alert banner appears:

> **Save the password now - it cannot be shown again.**
> The customer also receives it in the "Meta Verification Completed" email.

1. Click the **Copy e-mail & password** button.
2. The clipboard receives both strings formatted on separate lines.
3. The card updates to display a green confirmation indicator:
   - `✓ Login created`
   - Registered E-mail (monospace text).
   - Creation date timestamp.

---

## Automated Notification Behavior

| Service Type | Messaging Behavior |
| :--- | :--- |
| **Wabastore WhatsApp API & Blue Tick** | Creating the login automatically triggers the **Meta Verification Completed** email and WhatsApp message to the client, delivering their portal URL and credentials. |
| **Direct Services (Design Studio, Web Store)** | If provisioned by Accounts, credentials are delivered via standard automated account activation email. |
| **Custom Enterprise Deployments** | The consultant or account manager can provide the copied credentials directly via secure company communications. |

---

## Troubleshooting & Resetting Passwords

- **Email Already Exists:** If an error indicates the email is already in use, verify whether the client previously registered with Amuwa. Contact Super Admin to inspect the `auth.users` table or use a secondary business email.
- **Forgot Password:** Once created, passwords cannot be retrieved from the database. The client must use the **Forgot Password** self-service recovery flow on the `/client/login` screen.
- **Account Locked:** If a customer is returned to Sales, the login card displays *"The login can be created once the customer is back with you."* Complete re-verification first.
