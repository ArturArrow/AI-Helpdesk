import { Role, TicketCategory, TicketStatus } from "../generated/prisma/enums";
import { prisma } from "../src/lib/db";

// Adds 100 realistic demo tickets to a development database, spread over statuses,
// categories (including unclassified), senders, agents and the last 120 days, so the
// ticket list has something to sort and filter. Idempotent: each ticket has a fixed
// messageId, so re-running skips the ones already there. Refuses to run in production.

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed demo tickets with NODE_ENV=production");
  process.exit(1);
}

const { general_question: general, technical_question: technical, refund_request: refund } =
  TicketCategory;

// [subject, category the content belongs to, body]
const templates: [string, TicketCategory, string][] = [
  ["Can't log in after password reset", technical, "I reset my password this morning and now the login page just says 'Invalid email or password'. I've tried three times."],
  ["Refund for duplicate charge", refund, "I was charged twice for my March invoice (two identical charges of $49). Please refund one of them."],
  ["What are your support hours?", general, "Are you available on weekends? I'm in the CET time zone and mostly work evenings."],
  ["Export to CSV is missing columns", technical, "When I export my orders to CSV the 'shipping address' and 'notes' columns are empty even though they're filled in the app."],
  ["Cancel subscription and refund unused months", refund, "I paid annually but we're closing the business. Can I get a refund for the remaining 7 months?"],
  ["Do you offer discounts for non-profits?", general, "We're a registered charity with 12 staff. Is there a non-profit plan?"],
  ["App crashes when uploading a photo", technical, "On my iPhone 15 (iOS 19) the app closes immediately after I pick a photo from the gallery."],
  ["Order #48213 arrived damaged", refund, "The box was crushed and the ceramic mug inside is broken. Photos attached. I'd like a refund rather than a replacement."],
  ["How do I add another user to my account?", general, "My colleague needs access to our workspace. Where do I invite them?"],
  ["Two-factor codes not arriving by SMS", technical, "I'm not receiving the 2FA text messages. My number is correct in the settings and other services' SMS work fine."],
  ["Charged after cancelling trial", refund, "I cancelled my free trial on day 12 but was still charged $29 on day 14. Please reverse the charge."],
  ["Is my data stored in the EU?", general, "Our legal team needs to know where customer data is hosted for GDPR purposes."],
  ["Webhook deliveries failing with 500", technical, "Since yesterday all webhook deliveries to our endpoint show status 500 in your dashboard, but our server logs show no requests at all."],
  ["Wrong size delivered, want my money back", refund, "I ordered a size M jacket and received XL. I don't want an exchange, please refund."],
  ["Change the email on my account", general, "I'm moving from my old work email to a new one. How can I update it?"],
  ["Dashboard loads forever in Firefox", technical, "The dashboard spinner never stops in Firefox 142. Chrome works fine. Cleared cache already."],
  ["Refund request for event tickets", refund, "The concert on 14 June was cancelled by the organiser. I'd like a refund for my two tickets."],
  ["Where can I find my invoices?", general, "Our accountant needs PDF invoices for the last quarter. Where can I download them?"],
  ["API returns 429 too often", technical, "We're getting rate limited at around 30 requests per minute although the docs say the limit is 120."],
  ["Unauthorised transaction on my card", refund, "There's a $199 charge from your company that I didn't make. Please refund it and check my account security."],
  ["Do you have a mobile app for Android?", general, "I only see the iOS app in the store. Is an Android version planned?"],
  ["Password reset email never arrives", technical, "I've requested a reset link five times and checked spam. Nothing arrives at my Gmail address."],
  ["Refund for late delivery (guaranteed next-day)", refund, "I paid for next-day delivery but the parcel took 6 days. I'd like the delivery fee refunded."],
  ["Can I pause my subscription?", general, "I'll be travelling for two months. Can I pause instead of cancelling?"],
  ["Sync between desktop and phone stopped working", technical, "Notes I create on my laptop no longer show up on my phone. Both are on the latest version."],
  ["Return and refund for unopened headphones", refund, "I bought the headphones as a gift but the recipient already has a pair. Box is still sealed."],
  ["How do I delete my account?", general, "I'd like to close my account and have my data deleted."],
  ["Search doesn't find recent documents", technical, "Documents uploaded in the last week don't appear in search results, older ones do."],
  ["Overcharged for VAT", refund, "I'm a VAT-registered business in Germany and entered my VAT ID, but I was still charged 19% VAT."],
  ["Do you integrate with Slack?", general, "We'd like notifications in a Slack channel when a new order comes in. Is that possible?"],
  ["Error 'Session expired' every few minutes", technical, "I get logged out every 5-10 minutes with 'Session expired', even while actively working."],
  ["Refund for a course I couldn't access", refund, "I paid for the Advanced Excel course but the video player never loads. I'd like my money back."],
  ["Holiday shipping deadlines?", general, "What's the last day to order for delivery before Christmas to the UK?"],
  ["PDF invoices show the wrong company name", technical, "Our invoices still show our old company name even though we updated it in billing settings."],
  ["Refund: service not as described", refund, "The plan page said unlimited storage but we hit a 50 GB cap. I'd like a refund for this month."],
  ["Can I upgrade mid-cycle?", general, "If I upgrade from Basic to Pro halfway through the month, how is it billed?"],
  ["Import from Excel fails at row 1,001", technical, "Importing a 3,000-row spreadsheet stops at row 1,001 with 'Unexpected error'. Smaller files work."],
  ["Gift card not applied at checkout, charged full price", refund, "I entered my $50 gift card code but was charged the full $120. Please refund the $50 difference."],
  ["Accessibility: is there a screen reader mode?", general, "One of our team members uses NVDA. Does your app support screen readers?"],
  ["Notifications arrive hours late", technical, "Push notifications for new messages arrive 2-3 hours after the message was sent."],
  ["Refund for accidental renewal", refund, "I forgot to turn off auto-renew and was charged $240 yesterday. I haven't used the service this year. Can you refund?"],
  ["Where is your office located?", general, "We'd like to send a physical letter. What's your postal address?"],
  ["Calendar events show in the wrong time zone", technical, "All my events are shifted by 2 hours. My profile time zone is Europe/Warsaw."],
  ["Missing items in my order, request partial refund", refund, "Order #51877 was missing two of the five items. I'd like a refund for the missing ones."],
  ["Do you have an affiliate programme?", general, "I run a small blog about productivity tools and would like to become an affiliate."],
  ["Can't connect my bank account", technical, "Connecting my ING account fails with 'Provider error, try again later' for the past three days."],
  ["Refund after hotel booking cancellation", refund, "I cancelled my booking 10 days before arrival, within the free cancellation window, but no refund yet."],
  ["Is there a student discount?", general, "I'm a university student. Do you offer reduced pricing with a student ID?"],
  ["Images not loading on product pages", technical, "On our store, product images show as broken links since this morning. We haven't changed anything."],
  ["Refund for subscription I never signed up for", refund, "I noticed monthly charges of $9.99 since January. I never created an account with you."],
  ["How long is the warranty?", general, "What is the warranty period for the X200 vacuum and what does it cover?"],
  ["Keyboard shortcuts stopped working", technical, "Ctrl+K and other shortcuts do nothing since the last update on macOS."],
  ["Refund the difference after price drop", refund, "I bought the monitor for $329 and a week later it's $279. Do you have price protection?"],
  ["Can I get a quote for 200 seats?", general, "We're evaluating your product for our company. Could you send a quote for 200 users?"],
  ["Reports show zero revenue for yesterday", technical, "The daily revenue report shows $0 for yesterday even though we had 40+ orders."],
  ["Charged in USD instead of EUR", refund, "My account is set to EUR but I was charged in USD with conversion fees. Please refund the fees."],
  ["What payment methods do you accept?", general, "Can we pay by bank transfer instead of credit card?"],
  ["SSO login redirects in a loop", technical, "After signing in with Okta we're redirected back to the login page endlessly."],
  ["Refund for broken item after 2 days", refund, "The kettle stopped working after two days of normal use. I'd like a refund."],
  ["Feature request: dark mode", general, "Any plans for a dark mode? The white background is hard on the eyes at night."],
  ["File upload limit too low?", technical, "Uploading a 30 MB video fails with 'File too large' but your docs say the limit is 100 MB."],
  ["Double booking fee refund", refund, "Your system charged me the booking fee twice for reservation R-7734."],
  ["How do I change my billing address?", general, "We moved offices. Where do I update the address on our invoices?"],
  ["Mobile app shows blank screen after update", technical, "After updating to version 5.2 on Android the app opens to a white screen."],
  ["Refund: cancelled within 14-day cooling-off period", refund, "I cancelled on day 9 of my subscription, within the EU 14-day withdrawal right. Please refund."],
  ["Do you offer training sessions?", general, "Our team would benefit from an onboarding session. Is live training available?"],
  ["Emails from the app go to spam", technical, "Our customers report that order confirmation emails land in their spam folder."],
  ["Promo code didn't work, refund the discount", refund, "The code SPRING20 was rejected at checkout although it was valid until the end of the month."],
  ["Can I transfer my licence to a new computer?", general, "I'm replacing my laptop. How do I move my licence?"],
  ["Checkout button unresponsive on Safari", technical, "Customers on Safari can't complete checkout; the 'Pay now' button does nothing."],
  ["Refund for unused credits", refund, "We're switching providers and have 1,200 unused credits. Can those be refunded?"],
  ["Is there a public roadmap?", general, "I'd love to see what features are coming next. Do you publish a roadmap?"],
  ["Data from last week missing after migration", technical, "After your maintenance on Sunday, all entries from 8-14 September are gone from our account."],
  ["Refund for parcel lost in transit", refund, "Tracking has shown 'in transit' for 3 weeks. The courier says it's lost."],
  ["Can I have multiple workspaces?", general, "I manage two separate clients. Can I have two workspaces under one login?"],
  ["Printing labels cuts off the address", technical, "Shipping labels print with the last line of the address cut off on our Zebra printer."],
  ["Refund: charged for premium support I didn't order", refund, "Our last invoice includes 'Premium support $99' which we never requested."],
  ["Opening hours on public holidays?", general, "Will your support be available on 11 November?"],
  ["Timeouts when generating large reports", technical, "Annual reports time out after 60 seconds with a gateway error."],
  ["Refund for defective phone case", refund, "The case cracked on the first day. Order #60212."],
  ["How secure is my payment information?", general, "Do you store card numbers? Are you PCI compliant?"],
  ["Language setting keeps resetting to English", technical, "I set the interface to Polish but it resets to English every time I log in."],
  ["Want a refund, product doesn't fit my car", refund, "The roof rack doesn't fit a 2021 Octavia even though the site said it's compatible."],
  ["Referral bonus not received", general, "I referred two friends who signed up last month, but I haven't received the referral credit."],
  ["Barcode scanner not recognised", technical, "Our USB barcode scanner works in Notepad but not in your web app's inventory screen."],
  ["Refund after flight schedule change", refund, "The airline moved my flight by 9 hours and I can't travel. I'd like a full refund of the booking."],
  ["Can I change my username?", general, "I made a typo in my username when signing up. Can it be changed?"],
  ["Charts render blank in exported PDF", technical, "When I export the dashboard to PDF, all charts are blank rectangles."],
  ["Refund for a membership I cancelled last month", refund, "I cancelled on 2 August but was charged again on 1 September."],
  ["Question about data retention", general, "How long do you keep data after an account is closed?"],
  ["Autosave lost two hours of work", technical, "The editor showed 'Saved' but after a reload two hours of changes were gone."],
  ["Hotel room not as advertised, refund please", refund, "The room had no air conditioning although it was listed. We had to move to another hotel."],
  ["Do you ship to Norway?", general, "I can't select Norway at checkout. Do you ship there?"],
  ["Access denied after role change", technical, "Our admin changed my role to Editor and now I get 'Access denied' on every page."],
  ["Refund for concert I couldn't attend due to illness", refund, "I have a doctor's note. Is a refund possible under your policy?"],
  ["Thank you for the quick help!", general, "Just wanted to say thanks to Beata for sorting out my billing issue so quickly."],
  ["Integration with QuickBooks duplicates invoices", technical, "Every invoice synced to QuickBooks appears twice since the latest update."],
  ["Chargeback threat: no response to refund request", refund, "I asked for a refund three weeks ago and heard nothing. If I don't hear back I'll open a chargeback."],
  ["Can I use the product offline?", general, "We sometimes work on sites without internet. Does the app work offline?"],
  ["Zapier trigger fires twice for every new order", technical, "Our Zapier zap 'New order → Google Sheets' creates two rows for every order since Monday."],
];

const senders: [string, string][] = [
  ["Anna Kowalska", "anna.kowalska@example.com"],
  ["James O'Connor", "james.oconnor@example.net"],
  ["Maria García", "maria.garcia@example.org"],
  ["Tomasz Nowak", "t.nowak@example.com"],
  ["Emily Chen", "emily.chen@example.com"],
  ["Lukas Müller", "lukas.mueller@example.de"],
  ["Sophie Martin", "sophie.martin@example.fr"],
  ["Oliver Smith", "oliver.smith@example.co.uk"],
  ["Aisha Khan", "aisha.khan@example.com"],
  ["Piotr Wiśniewski", "piotr.w@example.pl"],
  ["Hannah Johansson", "hannah.j@example.se"],
  ["Carlos Silva", "carlos.silva@example.com.br"],
  ["Yuki Tanaka", "yuki.tanaka@example.jp"],
  ["Grace Okafor", "grace.okafor@example.com"],
  ["Marco Rossi", "marco.rossi@example.it"],
  ["Zofia Lewandowska", "zofia.lewandowska@example.pl"],
  ["Daniel Cohen", "daniel.cohen@example.com"],
  ["Ingrid Hansen", "ingrid.hansen@example.no"],
  ["Rahul Mehta", "rahul.mehta@example.in"],
  ["Chloe Dubois", "chloe.dubois@example.fr"],
  ["Ben Carter", "ben.carter@example.com"],
  ["Katarzyna Zielińska", "kasia.zielinska@example.pl"],
  ["Mohammed Al-Farsi", "m.alfarsi@example.com"],
  ["Laura Bianchi", "laura.bianchi@example.it"],
  ["Noah Williams", "noah.williams@example.com"],
  ["Elena Popescu", "elena.popescu@example.ro"],
  ["Jakub Kamiński", "jakub.kaminski@example.pl"],
  ["Olivia Brown", "olivia.brown@example.com"],
  ["Mateo Fernández", "mateo.fernandez@example.es"],
  ["Acme Logistics Ltd", "support@acme-logistics.example.com"],
];

// Deterministic pseudo-random numbers, so every run produces the same tickets.
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(20260924);
const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;

const agents = await prisma.user.findMany({
  where: { deletedAt: null, role: Role.agent },
  select: { id: true },
});

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

const tickets = templates.map(([subject, category, body], i) => {
  const [senderName, senderEmail] = pick(senders);
  const ageDays = random() * 120;
  const createdAt = new Date(now - ageDays * DAY);

  // Older tickets are more likely to be finished; the last few days are mostly open.
  const roll = random();
  const status =
    ageDays < 3 ? (roll < 0.9 ? TicketStatus.open : TicketStatus.resolved)
    : ageDays < 30 ? (roll < 0.5 ? TicketStatus.open : roll < 0.85 ? TicketStatus.resolved : TicketStatus.closed)
    : roll < 0.15 ? TicketStatus.open : roll < 0.6 ? TicketStatus.resolved : TicketStatus.closed;

  // About a third of open tickets are still waiting for classification.
  const unclassified = status === TicketStatus.open && random() < 0.35;
  // Open tickets are assigned about half the time; finished ones always have an agent.
  const assigned = agents.length > 0 && (status !== TicketStatus.open || random() < 0.5);

  return {
    subject,
    body,
    senderName,
    senderEmail,
    messageId: `<seed-ticket-${i + 1}@helpdesk.local>`,
    status,
    category: unclassified ? null : category,
    assignedToId: assigned ? pick(agents).id : null,
    createdAt,
    updatedAt: status === TicketStatus.open ? createdAt : new Date(Math.min(now, createdAt.getTime() + random() * 5 * DAY)),
  };
});

const { count } = await prisma.ticket.createMany({ data: tickets, skipDuplicates: true });
console.log(`Seeded ${count} demo tickets (${tickets.length - count} already present).`);
await prisma.$disconnect();
