# Charlotte Property Detailing Customer Service Record App

Emergency mobile form for Jerry Johnson / Charlotte Property Detailing & Pressure Washing.

## What it does

- Captures customer first name, last name, service address, mobile phone, and email.
- Captures service performed and amount charged.
- Captures a finger/mouse digital signature.
- Sends a branded service record email to the customer and CCs Jerry/the business.

## Services included

- Soft House Washing
- Deck Staining
- Concrete Cleaning
- Concrete Sealing
- Other Pressure Washing Service

## Setup

```bash
npm install
cp .env.example .env
# edit .env with real OWNER_EMAIL and SMTP settings
npm start
```

Then open `http://localhost:3000`.

## Required before live email works

Real SMTP credentials are required. Use a domain mailbox, Gmail app password, SendGrid, Mailgun, Namecheap Private Email, etc.
