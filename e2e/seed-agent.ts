// Run by global-setup from server/ with only .env.test loaded. Creates the agent account the
// same way prisma/seed.ts creates the admin: through Better Auth's internalAdapter, so the
// password is hashed with the configured hasher. Credentials arrive via environment variables.
//
// The server modules are imported by a non-literal path so the root tsconfig doesn't pull
// server/ (which has its own tsconfig and module settings) into the e2e type-check.
const authPath = '../server/src/lib/auth.ts'
const dbPath = '../server/src/lib/db.ts'
const { auth } = await import(authPath)
const { prisma } = await import(dbPath)

const { E2E_AGENT_EMAIL: email, E2E_AGENT_PASSWORD: password, E2E_AGENT_NAME: name } = process.env
if (!email || !password || !name) {
  console.error('seed-agent: E2E_AGENT_EMAIL, E2E_AGENT_PASSWORD and E2E_AGENT_NAME must be set')
  process.exit(1)
}

const ctx = await auth.$context
const existing = await ctx.internalAdapter.findUserByEmail(email)

if (existing) {
  console.log(`Agent ${email} already exists`)
} else {
  const user = await ctx.internalAdapter.createUser(
    { email, name, emailVerified: true, role: 'agent' },
    { method: 'email-password' },
  )
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: await ctx.password.hash(password),
  })
  console.log(`Created agent ${email}`)
}

await prisma.$disconnect()
