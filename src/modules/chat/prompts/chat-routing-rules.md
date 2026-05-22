# Routing taxonomy

**This file is the single source of truth for how a user's question is bucketed into a route.**
It is consumer-neutral. Both the chat router (classifier prompt at `chat-router-system.md`)
and the agent's tool-use prompt (built in `chat-agent.service.ts`) load this file and add
their own consumer-specific framing around it. Do not put tool-use directives or JSON
output instructions here — keep this file purely about *what category a question belongs to*.

A user question falls into exactly one of:

## SQL — facts from rows in a structured database

Pick this when the answer is a count, value, listing, or concrete entity state that
typically lives in a table. The user does NOT need to mention "database", "SQL", or a
table name — route by the *shape of the answer* they want, not by keywords.

Examples:
- **Count / total / aggregate**: "how many users?", "how many orders last week?",
  "total revenue", "average session length".
- **Who / which / when / where lookup over entities** that typically live in tables
  (users, orders, sessions, events, subscriptions, customers, projects, etc.):
  "who signed up today?", "which order is largest?", "when was the last payment?".
- **Listing or filter**: "list users created this month", "show failed payments",
  "top 10 customers by spend".
- **Concrete factual question about entity state**: "is user X active?",
  "does order Y have a refund?".

## RAG — explanations from documentation, code, or specs

Pick this when the answer is about *how something works*, *what something means*, or
*why a decision was made*. The answer lives in narrative content (docs, code, specs,
runbooks), not in row counts.

Examples:
- How something is built, implemented, or architected.
- What a function / class / module does, or where to find it.
- Why a design choice was made, or what a spec / doc / runbook says.
- Onboarding, setup, or operational procedures.

## Ambiguous — could plausibly be either

Pick this when the question genuinely fits both buckets (e.g. "tell me about our users"
could mean a row summary OR an overview from docs).

**Tiebreaker policy:** prefer SQL for the ambiguous case. Row counts and concrete values
are more useful and more verifiable than doc snippets for most factual asks. After the
SQL answer comes back, narrative context from RAG can be added as a complement if needed.

(Consumers translate this policy into their own contract — the router lowers its
confidence so the agent fallback decides; the agent's tool-use prompt says "try
`query_database` first; follow up with `search_knowledge_base` if rows alone don't
cover the question".)
