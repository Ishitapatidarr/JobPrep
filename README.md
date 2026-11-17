# JobPrep

**AI-powered interview preparation platform** — paste a job description, add your resume or a short self-description, and JobPrep compares your profile with the role to produce a match score, your missing skills with learning recommendations, technical and behavioral interview questions with model answers, and a tailored ATS-friendly resume PDF.


**Demo Video Link:**
https://drive.google.com/file/d/1zF6PQABmU0hKEdo9EMxhEIhj_YpGAG6w/view?usp=sharing
---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation and Setup](#installation-and-setup)
- [Environment Variables](#environment-variables)
- [Running the Backend](#running-the-backend)
- [Running the Frontend](#running-the-frontend)
- [API Overview](#api-overview)
- [Authentication and Application Workflow](#authentication-and-application-workflow)
- [Screenshots](#screenshots)


---

## Overview

Preparing for a specific role usually means guessing which skills matter, which questions will come up and how to tailor your resume. JobPrep automates that analysis:

1. You provide a **target job description** plus a **PDF resume** and/or a **self-description**.
2. The backend asks an LLM to list every skill the job requires and judge — from written evidence in your profile — whether each one is *matched*, *partial* or *missing*.
3. The **match score is calculated in code** from that analysis (not invented by the AI), so different profiles and jobs produce genuinely different scores.
4. The result is saved to MongoDB as an **interview plan** that you can reopen at any time.

## Key Features

**Accounts and security**
- Register, log in and log out with email + password (passwords hashed with bcrypt).
- JWT stored in a cookie; protected API routes and protected frontend pages.
- Logout **blacklists the JWT** so the same token can't be reused.
- Clear, user-friendly validation and error messages on the login and registration forms.

**Interview plan generation**
- Input: job description (required, max 5,000 characters) + PDF resume (max 3 MB) and/or self-description — at least one of the two is required.
- Validated on both the frontend and backend (Zod).
- Resume text is extracted from the PDF with `pdf-parse`.
- **Skill analysis**: each job requirement is classified by importance (required / preferred / nice-to-have) and status (matched / partial / missing) with supporting evidence.
- **Match score** = 80 % weighted skill coverage + 20 % experience fit.
- **Exactly 10 technical and 10 behavioral questions**, each with the interviewer's intention and a model answer based on your real background.

**Results dashboard**
- Three-column layout: section navigation, content, and a match-score panel.
- Circular match-score indicator, matched skills and skill-gap badges.
- **Road Map: Missing Skills & Learning Recommendations** — gaps grouped by High / Medium / Low severity, each with why it matters for the job, topics to learn and practical focus areas.
- Expandable question cards for technical and behavioral questions.

**Saved plans**
- "My Recent Interview Plans" on the home page (newest first) with job title, date and match score.
- Any saved plan can be reopened without regenerating it.

**ATS-friendly resume PDF**
- One click generates a tailored resume from your saved profile and the job description.
- Rendered from a fixed single-column, ATS-friendly HTML template and converted to PDF with **Puppeteer**.
- Automatically scaled (down to 80 %) to fit **one A4 page** when possible, without dropping content.
- Contact details, links, skills, certifications and achievements are kept only if they appear in your own resume or self-description — the AI can't invent them.

## Tech Stack

| Layer | Technologies |
|---|---|
| Frontend | React 19, React Router 8, Vite 8, Axios, Sass (SCSS) |
| Backend | Node.js, Express 5, Mongoose 9 (MongoDB), Zod 4 |
| Auth | JSON Web Tokens (`jsonwebtoken`), `bcryptjs`, `cookie-parser` |
| AI | NVIDIA AI API (OpenAI-compatible) via the `openai` SDK — model `nvidia/nemotron-3.5-lightning-30b-a3b` |
| Files and PDF | `multer` (uploads), `pdf-parse` (resume text), `puppeteer` (HTML → PDF) |
| Tooling | `nodemon`, ESLint, `dotenv` |

## Project Structure

```
job-prep/
├── Backend/
│   ├── server.js                     # Loads env, connects to MongoDB, starts Express on port 3000
│   ├── .env.example                  # Template for Backend/.env (no real secrets)
│   ├── package.json
│   └── src/
│       ├── app.js                    # Express app: JSON, cookies, CORS, routes, error handler
│       ├── config/database.js        # MongoDB connection
│       ├── controllers/
│       │   ├── auth.controller.js        # register, login, logout, get-me
│       │   └── interview.controller.js   # generate / list / get plans, resume PDF
│       ├── middlewares/
│       │   ├── auth.middleware.js        # JWT + blacklist check
│       │   └── file.middleware.js        # Multer: PDF only, 3 MB limit
│       ├── models/
│       │   ├── user.model.js
│       │   ├── interviewReport.model.js
│       │   └── blacklist.model.js
│       ├── routes/
│       │   ├── auth.routes.js
│       │   └── interview.routes.js
│       └── services/
│           ├── ai.service.js             # Prompts, Zod schemas, match score, resume template, Puppeteer
│           └── temp.js                   # Sample resume / job description for local experiments
└── Frontend/
    ├── index.html
    ├── vite.config.js
    ├── package.json
    └── src/
        ├── main.jsx / App.jsx            # Providers + router
        ├── app.routes.jsx                # /login, /register, / (Home), /interview/:interviewId
        ├── style.scss, style/button.scss # Global theme and shared button styles
        └── features/
            ├── auth/                     # Context, useAuth hook, API service, Login/Register pages,
            │                             # Protected route, LogoutButton
            └── interview/                # Context, useInterview hook, API service,
                                          # Home and Interview (results) pages + styles
```

## Prerequisites

- **Node.js 20.19+ or 22.12+** (required by Vite 8) and **npm**
- **MongoDB** — a [MongoDB Atlas](https://www.mongodb.com/atlas) cluster or a local MongoDB server
- **NVIDIA API key** — from [build.nvidia.com](https://build.nvidia.com)
- **Git**

> `npm install` in `Backend` also downloads a Chromium build for Puppeteer (a few hundred MB). This is needed for resume PDF generation.

## Installation and Setup

```bash
# 1. Clone the repository
git clone https://github.com/Ishitapatidarr/JobPrep.git
cd JobPrep

# 2. Install backend dependencies
cd Backend
npm install

# 3. Install frontend dependencies
cd ../Frontend
npm install
```

Then create your backend environment file as described below.

## Environment Variables

The backend reads its configuration from **`Backend/.env`**. This file is **not** part of the repository — create your own from the example:

```bash
# from the project root
cp Backend/.env.example Backend/.env      # macOS / Linux / Git Bash
copy Backend\.env.example Backend\.env    # Windows Command Prompt
```

Then open `Backend/.env` and fill in your own values:

| Variable | Required | Description |
|---|---|---|
| `MONGO_URI` | Yes | MongoDB connection string |
| `JWT_SECRET` | Yes | Long random string used to sign login tokens |
| `NVIDIA_API_KEY` | Yes | NVIDIA AI API key used for plan and resume generation |

> **Never commit `Backend/.env`.** It is listed in `.gitignore`. Only `Backend/.env.example`, which contains placeholders, belongs in the repository.

The frontend needs no environment file. Note that a few values are currently set in code: the backend port (`3000`, in `Backend/server.js`), the allowed CORS origin (`http://localhost:5173`, in `Backend/src/app.js`) and the API base URL (`http://localhost:3000`, in `Frontend/src/features/*/services/*.api.js`). Change them there if you run on different ports or deploy.

## Running the Backend

```bash
cd Backend
npm run dev
```

This starts the API with `nodemon` (auto-restarts on changes) at **http://localhost:3000**. You should see `Server is running on port 3000` and `Connected to MongoDB`.

## Running the Frontend

In a second terminal:

```bash
cd Frontend
npm run dev
```

Open **http://localhost:5173**. Other frontend scripts:

| Command | Purpose |
|---|---|
| `npm run build` | Production build into `Frontend/dist` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Run ESLint |

## API Overview

Base URL: `http://localhost:3000`. Routes marked 🔒 require the `token` cookie set at login (send requests with credentials).

### Auth — `/api/auth`

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Create an account. Body: `{ username, email, password }`. Sets the `token` cookie. |
| `POST` | `/api/auth/login` | Log in. Body: `{ email, password }`. Sets the `token` cookie. |
| `GET` | `/api/auth/logout` | Blacklists the current token and clears the cookie. |
| `GET` 🔒 | `/api/auth/get-me` | Returns the logged-in user (`id`, `username`, `email`). |

### Interview plans — `/api/interview`

| Method | Endpoint | Description |
|---|---|---|
| `POST` 🔒 | `/api/interview/` | Generate and save a plan. `multipart/form-data`: `jobDescription` (required), `selfDescription`, `resume` (PDF, ≤ 3 MB). At least one of `resume` / `selfDescription` is required. |
| `GET` 🔒 | `/api/interview/` | List the user's plans (newest first, summary fields only). |
| `GET` 🔒 | `/api/interview/report/:interviewId` | Full plan: questions, skill analysis, skill gaps, match score. |
| `POST` 🔒 | `/api/interview/resume/pdf/:interviewReportId` | Generate and download the tailored resume as `application/pdf`. |

Errors are returned as JSON, e.g. `{ "message": "Job description is required." }`, with status `400` (validation), `401` (not logged in / invalid or blacklisted token), `404` (plan not found or not yours) or `502` (AI service failure).

## Authentication and Application Workflow

**Authentication**
1. **Register / log in** → the backend validates the credentials, hashes or compares the password with bcrypt and sets a JWT (valid for 1 day) in the `token` cookie.
2. The frontend sends the cookie with every request (`withCredentials`). On load it calls `GET /api/auth/get-me` to restore the session.
3. **Protected pages** (`/` and `/interview/:id`) redirect to `/login` when no user is logged in.
4. **Logout** → the token is added to a blacklist collection and the cookie is cleared; any later request with that token is rejected with `401`.

**Application flow**
1. On the **Home** page, enter the job description and upload a PDF resume and/or write a self-description.
2. Click **Generate My Interview Strategy** → the plan is generated, validated, scored and saved.
3. You're taken to the **results dashboard**:
   - **Technical Questions** and **Behavioral Questions** — 10 expandable cards each.
   - **Road Map** — missing skills by severity with topics to learn.
   - **Right panel** — match score ring, matched skills and skill gaps.
4. Click **Download Resume** to get a tailored, one-page ATS-friendly PDF.
5. Back on Home, **My Recent Interview Plans** lists every saved plan so you can reopen it.

## Screenshots

Login
<img width="1917" height="948" alt="image" src="https://github.com/user-attachments/assets/fec3b145-6dfd-4aa7-9108-49ce56e3b73b" />

Register
<img width="1917" height="955" alt="image" src="https://github.com/user-attachments/assets/a5ea7056-e2ac-457c-9dd2-2568c53db962" />

Homepage
<img width="1067" height="906" alt="image" src="https://github.com/user-attachments/assets/a0e46b07-2dab-4859-9998-380679caf176" />

<img width="1035" height="901" alt="image" src="https://github.com/user-attachments/assets/a864c087-34d7-4f47-a10d-9416376bbad6" />
<img width="1910" height="966" alt="image" src="https://github.com/user-attachments/assets/54dea5fa-6fe2-4090-a067-d061209329ca" />


AI-generated Interview plan
<img width="1287" height="901" alt="image" src="https://github.com/user-attachments/assets/424fe5d3-c47e-4cba-889d-a252d41f6d28" />
<img width="1282" height="906" alt="image" src="https://github.com/user-attachments/assets/0cac96a8-7059-4825-9578-ffbea466b3fb" />
<img width="1285" height="907" alt="image" src="https://github.com/user-attachments/assets/6c323084-a865-463a-a195-8d0afbdcd03f" />

ATS friendly resume according to targeted Job Description
 <img width="1295" height="961" alt="image" src="https://github.com/user-attachments/assets/eb16766b-37fd-4a84-93a5-35a320b91f23" />

MongoDB collections
<img width="1917" height="1018" alt="image" src="https://github.com/user-attachments/assets/df48ee36-9849-4fa7-a7f9-d2572c207dc0" />




