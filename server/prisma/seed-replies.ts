import { Role, ReplySender } from "../generated/prisma/enums";
import { prisma } from "../src/lib/db";

// Adds a 20-message conversation to ticket 12 of a development database, alternating between
// an agent and the customer, oldest first, so the thread and the AI summary have a long history
// to work with. The content follows ticket 12 as seeded by seed-tickets.ts ("App crashes when
// uploading a photo"). Idempotent: skipped when the ticket already has replies. Refuses to run
// in production.

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed demo replies with NODE_ENV=production");
  process.exit(1);
}

const TICKET_ID = 12;
const MIN_LINES = 10;

// Agent and customer messages, alternating, agent first. {agent} is the agent's name.
const conversation: string[] = [
  `Hi James,

Thanks for reaching out, and sorry the app is closing on you.
I'd like to narrow this down, so could you tell me a few things?
1. Which version of the app you have (Settings > About in the app).
2. Whether it happens with every photo, or only some of them.
3. Whether the photos were taken with the iPhone camera or saved from elsewhere.
4. Roughly when it started, e.g. after an app or iOS update.
In the meantime, a quick restart of the phone is worth a try.
It clears out a surprising number of upload problems.

Best regards,
{agent}`,

  `Hi,

Thanks for getting back to me so quickly.
The app version is 4.8.0, installed from the App Store last week.
It happens with every photo I pick from the gallery, without exception.
They're all taken with the iPhone 15 camera, nothing downloaded.
I think it started right after I updated to iOS 19.0.1.
Before that I uploaded photos almost every day with no issues.
I restarted the phone as you suggested, but it still crashes.
The app doesn't show any error, it just disappears to the home screen.

Thanks,
James`,

  `Hi James,

Thanks, that's very helpful, and the iOS update is a strong clue.
Could you try deleting the app and installing it again from the App Store?
Your data is stored on our servers, so nothing will be lost.
You'll just need to sign in again after reinstalling.
When the app asks for access to your photos, please choose "Allow Full Access".
iOS 19 changed how limited photo access works, and that may be involved.
After that, please try uploading one photo and let me know what happens.
If it still crashes, note the exact time so I can look for it in our logs.

Best regards,
{agent}`,

  `Hi,

I deleted and reinstalled the app as you described.
I signed in again without any problem and all my data is there.
When it asked about photos I picked "Allow Full Access".
Unfortunately it still crashed on the first photo I tried.
The time was 14:32 today, Central European Time.
I tried a second photo at 14:34 and it crashed again.
I also noticed it takes about two seconds after I tap the photo before it closes.
So it seems to get a bit further than just opening the picker.

Regards,
James`,

  `Hi James,

Thanks for trying that and for the exact times.
I found both crashes in our crash reports at 14:32 and 14:34.
They happen while the app is converting the photo before the upload starts.
iPhone cameras save photos as HEIC by default, and the app converts them to JPEG.
Could you try a quick test for me to confirm this?
Go to Settings > Camera > Formats on your phone and pick "Most Compatible".
Then take a new photo and try uploading that one.
This only affects new photos, your existing ones stay as they are.
You can switch the setting back afterwards.

Best regards,
{agent}`,

  `Hi,

Good news and bad news.
I changed the camera format to "Most Compatible" as you said.
I took a new photo of my desk and it uploaded without any problem.
So it looks like JPEG photos work and HEIC ones don't.
The bad news is that I have hundreds of older photos in HEIC.
Many of them are the ones I actually need to upload for work.
I'd also rather not keep the camera on the less efficient format.
The photos take up a lot more space that way.
Is there a fix coming for the HEIC photos?

Thanks,
James`,

  `Hi James,

That test was exactly what we needed, thank you.
It confirms the crash is in the HEIC conversion on iOS 19.
I've passed the details and your crash reports to our mobile team.
They've already found the cause: iOS 19 returns HEIC images in a new color format.
Our converter doesn't handle that format yet and runs out of memory.
A fix is in progress, and I'll let you know as soon as there's a build to try.
Until then, a workaround for older photos is to share them from the Photos app.
Open the photo, tap Share, then pick our app from the list.
The share sheet sends a JPEG copy, which should upload fine.

Best regards,
{agent}`,

  `Hi,

Thanks for explaining what's going on, that makes sense.
I tried the share sheet workaround with three older photos.
Two of them uploaded fine through the share sheet.
The third one crashed the app again, at 10:15 this morning.
That one is a Live Photo, if that makes a difference.
I also tried selecting several photos at once in the share sheet.
With five photos selected, the app closed after the first one.
So for now I'm sharing them one at a time, which is slow but works.
Do you have any idea when the fix will be ready?

Regards,
James`,

  `Hi James,

Thanks for testing so thoroughly, the Live Photo detail is new to us.
I checked the 10:15 crash and it's a separate problem from the HEIC one.
Live Photos contain a short video, and the share sheet sends both parts.
Our app tries to process the video part as an image, which fails.
I've added this to the bug report so the team can fix both at once.
For multiple photos, the share sheet limit is a known issue we're also looking at.
The mobile team expects a test build within the next few days.
Would you be willing to try it through TestFlight before it's released?
If so, I'll send an invitation to james.oconnor@example.net.

Best regards,
{agent}`,

  `Hi,

Yes, I'm happy to test the new build through TestFlight.
Please send the invitation to james.oconnor@example.net.
I've never used TestFlight before, is there anything I need to set up?
Will the test build replace my current app or install next to it?
I want to be sure I won't lose any of my uploads or settings.
I use the app for work every day, so I can't be without it for long.
In the meantime, I'll keep using the share sheet one photo at a time.
I've also stopped trying Live Photos so I don't keep crashing the app.

Thanks,
James`,

  `Hi James,

Great, thank you! I've sent the TestFlight invitation just now.
To get started, install the free TestFlight app from the App Store.
Then open the invitation email on your iPhone and tap "View in TestFlight".
The test build replaces the App Store version of our app.
Your uploads and settings are kept, since they're stored on your account.
You can go back to the App Store version at any time by reinstalling it.
The test build is version 4.8.1 (build 412).
It includes the HEIC fix, but not the Live Photo fix yet.
Please let me know how it goes with your older HEIC photos.

Best regards,
{agent}`,

  `Hi,

I installed TestFlight and the test build 4.8.1 (412) without any trouble.
My account and settings were all still there, as you said.
I tried uploading ten older HEIC photos straight from the gallery.
All ten uploaded successfully, no crashes at all!
I also switched the camera back to "High Efficiency" and took a new photo.
That one uploaded fine too, so the HEIC problem looks fixed.
The uploads feel a little slower than before, maybe five seconds per photo.
Is that expected with the new conversion?
Live Photos still crash, but I understand that fix isn't in yet.

Thanks,
James`,

  `Hi James,

That's great news, thank you for testing so carefully.
I've shared your results with the mobile team, they were glad to hear it.
About the speed: the new converter is safer but a bit slower on large photos.
iPhone 15 photos are about 24 megapixels, so a few seconds is expected.
The team is already looking at doing the conversion in the background.
That way the next photo can start converting while the previous one uploads.
For the Live Photos, they'll treat them as still images and skip the video part.
Both changes should be in the next test build, 4.8.2.
I'll let you know as soon as it's available in TestFlight.

Best regards,
{agent}`,

  `Hi,

Thanks for the update, background conversion sounds like a good idea.
Five seconds isn't a big deal for a single photo.
But when I upload a whole site visit it can be 40 or 50 photos.
That adds up to a few minutes of waiting with the app open.
Will the upload keep going if I switch to another app?
At the moment it seems to pause when I leave the app.
That's not new, it was like that before the iOS update as well.
It would help a lot if uploads could finish in the background.
I'll wait for 4.8.2 and test the Live Photos when it's out.

Regards,
James`,

  `Hi James,

That's a fair point about large batches, thanks for mentioning it.
You're right that uploads currently pause when the app is in the background.
iOS gives apps only a short time to run in the background by default.
Our team plans to switch uploads to iOS background transfers.
With that, uploads keep going even if you leave the app or lock the phone.
It's a bigger change, so it won't be in 4.8.2, but it's on the roadmap.
I've added your use case of 40-50 photo site visits to the feature request.
Real examples like that help the team decide what to build first.
In the meantime, keeping the screen on during a big upload avoids the pause.

Best regards,
{agent}`,

  `Hi,

Understood, thanks for adding it to the feature request.
Keeping the screen on works for now, I'll set auto-lock to "Never" during uploads.
One more thing I noticed while testing 4.8.1 today.
After uploading, a couple of photos showed up rotated sideways in the web app.
In the iPhone app they look fine, only the web version is wrong.
Both were portrait photos taken with the phone held upright.
The ones I uploaded with the App Store version before don't have this problem.
So it might be related to the new converter.
I can send you the names of the two photos if that helps.

Thanks,
James`,

  `Hi James,

Thank you, that's a great catch, and yes, please send the photo names.
It does sound like the new converter, and here's why.
Photos store their rotation as a separate tag instead of rotating the pixels.
The iPhone app reads that tag, but the web app relies on the converter to apply it.
The 4.8.1 converter seems to drop the tag for some photos.
I've reported it to the team so it gets fixed in 4.8.2 along with the Live Photos.
Your existing photos don't need to be uploaded again.
Once the fix is out, we'll correct the rotation of affected photos on our side.
Thanks again for all your help with testing.

Best regards,
{agent}`,

  `Hi,

The two photos are "IMG_4821" and "IMG_4836", both uploaded yesterday.
Good to hear I won't need to upload them again.
TestFlight just told me that 4.8.2 (build 420) is available, so I installed it.
I tested five Live Photos and all of them uploaded without crashing.
The two rotated photos from before still look sideways in the web app.
But new portrait photos uploaded with 4.8.2 show the right way up.
Uploading 20 photos in a row felt noticeably faster than with 4.8.1.
The share sheet now accepts several photos at once, too.
Everything I use day to day seems to work again.

Thanks,
James`,

  `Hi James,

That's wonderful to hear, thank you for testing 4.8.2 so quickly.
I've confirmed with the team that the rotation fix is in this build.
They've corrected IMG_4821 and IMG_4836 on our side just now.
Please refresh the web app, and both should show the right way up.
Version 4.8.2 will be released on the App Store early next week.
When it's out, the App Store version will replace the TestFlight one automatically.
You can leave TestFlight installed or delete it, whichever you prefer.
Background uploads are still on the roadmap, and I'll keep your request attached.
If everything looks good on your side, I'll mark this ticket as resolved.

Best regards,
{agent}`,

  `Hi,

I refreshed the web app and both photos are the right way up now.
Thanks for fixing them on your side, that saved me some work.
I'll keep TestFlight installed in case you need help testing again.
Everything works well for me now, so please go ahead and resolve the ticket.
I really appreciate how patient and thorough you were throughout this.
It was clear at every step what you needed from me and why.
I'll look out for background uploads in a future update.
If the rotation issue comes back I'll reply to this ticket.
Thanks again, and have a great week.

Best regards,
James`,
];

const ticket = await prisma.ticket.findUnique({
  where: { id: TICKET_ID },
  select: { createdAt: true, assignedToId: true, _count: { select: { replies: true } } },
});
if (!ticket) {
  console.error(`Ticket ${TICKET_ID} doesn't exist; run db:seed:tickets first`);
  process.exit(1);
}
if (ticket._count.replies > 0) {
  console.log(`Ticket ${TICKET_ID} already has ${ticket._count.replies} replies; nothing added`);
  await prisma.$disconnect();
  process.exit(0);
}

// The ticket's assignee writes the agent replies, or the first active agent when it has none.
const agent = await prisma.user.findFirst({
  where: { deletedAt: null, role: Role.agent, ...(ticket.assignedToId && { id: ticket.assignedToId }) },
  orderBy: { createdAt: "asc" },
  select: { id: true, name: true },
});
if (!agent) {
  console.error("No active agent to write the agent replies");
  process.exit(1);
}

for (const [i, body] of conversation.entries()) {
  const lines = body.split("\n").filter((line) => line.trim()).length;
  if (lines < MIN_LINES) throw new Error(`Reply ${i + 1} has ${lines} lines, fewer than ${MIN_LINES}`);
}

// One reply every 3-9 hours after the ticket, oldest first, so the thread reads in order.
const step = (i: number) => (3 + ((i * 5) % 7)) * 60 * 60 * 1000;
let time = ticket.createdAt.getTime();

const replies = conversation.map((body, i) => {
  time += step(i);
  const isAgent = i % 2 === 0;
  return {
    ticketId: TICKET_ID,
    body: isAgent ? body.replaceAll("{agent}", agent.name) : body,
    sender: isAgent ? ReplySender.agent : ReplySender.customer,
    authorId: isAgent ? agent.id : null,
    // A customer reply comes from an email, so it has a Message-ID; agent replies don't.
    messageId: isAgent ? null : `<seed-ticket-${TICKET_ID}-reply-${i + 1}@helpdesk.local>`,
    createdAt: new Date(time),
  };
});

const { count } = await prisma.reply.createMany({ data: replies, skipDuplicates: true });
console.log(`Added ${count} replies to ticket ${TICKET_ID}, agent replies by ${agent.name}`);
await prisma.$disconnect();
