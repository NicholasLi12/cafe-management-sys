# cafe-management-sys

A full-stack cafe operations and profit management platform built with Next.js, Supabase, and Tailwind CSS.

## Stack
- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase Auth + PostgreSQL
- Vercel deployment

## Local setup
1. Copy `.env.example` to `.env.local`
2. Fill in your Supabase project values
3. Apply the SQL files in `supabase/migrations/` to your Supabase project in filename order
4. Run `npm install`
5. Run `npm run dev`
6. Visit `http://localhost:3000`

## MVP scope
- Authentication with owner profiles
- Table-based dine-in order flow
- Menu with recipe-linked inventory deduction
- Low-stock restock workflow
- Daily gross revenue and profit summary
- Demo delivery order simulation
