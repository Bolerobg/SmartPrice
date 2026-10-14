/**
 * Защита на имейла при регистрация.
 *
 * Защо съществува: имейл се прави безплатно. Ако не хванем алиасите и
 * еднократните пощи, един човек си прави 10 акаунта за пет минути и
 * участва в томболата 10 пъти.
 *
 * Тук са трите неща на едно място:
 *   1. emailKey()            — „иван+1@gmail.com“ == „и.ван@gmail.com“ == един човек;
 *   2. isDisposableEmail()   — пощи за еднократна употреба (temp-mail и подобни);
 *   3. domainAcceptsMail()   — домейнът изобщо приема ли поща (MX запис).
 */
import { promises as dns } from 'node:dns';

/**
 * Нормализиран ключ на имейла. ВАЖНО: същата логика като normalize_email()
 * в базата (migrations/015_anti_fraud.sql). Ако промениш едното, промени и другото,
 * иначе уникалният индекс и кодът ще гледат различни неща.
 */
export function emailKey(raw: unknown): string {
  const e = String(raw ?? '')
    .trim()
    .toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return e;
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const noTag = local.split('+')[0] ?? '';
  // Gmail (и Googlemail) игнорира точките и всичко след „+“.
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return `gmail.com:${noTag.replace(/\./g, '')}`;
  }
  // Останалите игнорират само „+етикета“ (Outlook, Proton, Yahoo, ABV…).
  return `${domain}:${noTag}`;
}

/** Домейнът на имейла (малки букви). */
export function emailDomain(raw: unknown): string {
  const e = String(raw ?? '')
    .trim()
    .toLowerCase();
  const at = e.lastIndexOf('@');
  return at < 0 ? '' : e.slice(at + 1);
}

/** Домейни, които са само за еднократна поща — блокираме ги направо. */
const DISPOSABLE_DOMAINS = new Set([
  '0-mail.com', '0815.ru', '0clickemail.com', '10mail.org', '10minutemail.com',
  '10minutemail.net', '10minutemail.org', '10minutemail.co.za', '20minutemail.com',
  '2prong.com', '30minutemail.com', '33mail.com', '4warding.com', '5ymail.com',
  '6paq.com', '7tags.com', '9ox.net', 'anonbox.net', 'anonmails.de', 'anonymbox.com',
  'antichef.com', 'antireg.ru', 'armyspy.com', 'binkmail.com', 'bobmail.info',
  'bofthew.com', 'bugmenot.com', 'bumpymail.com', 'byom.de', 'centermail.com',
  'chammy.info', 'chogmail.com', 'clrmail.com', 'cool.fr.nf', 'correo.blogos.net',
  'cosmorph.com', 'courriel.fr.nf', 'cuvox.de', 'dacoolest.com', 'dandikmail.com',
  'dayrep.com', 'deadaddress.com', 'despam.it', 'devnullmail.com', 'dfgh.net',
  'digitalsanctuary.com', 'discardmail.com', 'dispostable.com', 'dodgit.com',
  'dontreg.com', 'dontsendmespam.de', 'dump-email.info', 'dumpandjunk.com',
  'dumpmail.de', 'dumpyemail.com', 'e4ward.com', 'email60.com', 'emaildienst.de',
  'emailgo.de', 'emailias.com', 'emailinfive.com', 'emailmiser.com', 'emailsensei.com',
  'emailtemporario.com.br', 'emailthe.net', 'emailtmp.com', 'emailwarden.com',
  'emailx.at.hm', 'emailxfer.com', 'emz.net', 'enterto.com', 'ephemail.net',
  'etranquil.com', 'etranquil.net', 'evopo.com', 'explodemail.com', 'fakeinbox.com',
  'fakeinformation.com', 'fastacura.com', 'fastchevy.com', 'fatflap.com',
  'filzmail.com', 'fixmail.tk', 'fizmail.com', 'flyspam.com', 'freundin.ru',
  'fux0ringduh.com', 'garliclife.com', 'get1mail.com', 'get2mail.fr',
  'getairmail.com', 'getonemail.com', 'getonemail.net', 'girlsundertheinfluence.com',
  'gishpuppy.com', 'gmial.com', 'goemailgo.com', 'gorillaswithdirtyarmpits.com',
  'gotmail.com', 'gotmail.net', 'gotmail.org', 'gotti.otherinbox.com', 'grr.la',
  'guerillamail.biz', 'guerillamail.com', 'guerillamail.de', 'guerillamail.info',
  'guerillamail.net', 'guerillamail.org', 'guerrillamail.biz', 'guerrillamail.com',
  'guerrillamail.de', 'guerrillamail.info', 'guerrillamail.net', 'guerrillamail.org',
  'haltospam.com', 'hatespam.org', 'hidemail.de', 'hotpop.com', 'hulapla.de',
  'ieatspam.eu', 'ieatspam.info', 'imails.info', 'inboxalias.com', 'incognitomail.com',
  'insorg-mail.info', 'ipoo.org', 'irish2me.com', 'jetable.com', 'jetable.fr.nf',
  'jetable.net', 'jetable.org', 'jnxjn.com', 'junk1e.com', 'kasmail.com', 'klassmaster.com',
  'klzlk.com', 'koszmail.pl', 'kurzepost.de', 'letthemeatspam.com', 'lhsdv.com',
  'lifebyfood.com', 'link2mail.net', 'litedrop.com', 'lol.ovpn.to', 'lookugly.com',
  'lortemail.dk', 'lr78.com', 'lroid.com', 'mail-filter.com', 'mail-temporaire.fr',
  'mail.by', 'mail.mezimages.net', 'mail.zp.ua', 'mail1a.de', 'mail21.cc',
  'mail2rss.org', 'mail333.com', 'mailbidon.com', 'mailblocks.com', 'mailbucket.org',
  'mailcat.biz', 'mailcatch.com', 'mailde.de', 'mailde.info', 'maildrop.cc',
  'maileater.com', 'mailexpire.com', 'mailfa.tk', 'mailforspam.com', 'mailfreeonline.com',
  'mailguard.me', 'mailimate.com', 'mailin8r.com', 'mailinater.com', 'mailinator.com',
  'mailinator.net', 'mailinator2.com', 'mailincubator.com', 'mailismagic.com',
  'mailme.lv', 'mailme24.com', 'mailmetrash.com', 'mailmoat.com', 'mailnator.com',
  'mailnesia.com', 'mailnull.com', 'mailorg.org', 'mailpop.in', 'mailscrap.com',
  'mailshell.com', 'mailsiphon.com', 'mailslite.com', 'mailtemp.info', 'mailtome.de',
  'mailtothis.com', 'mailtrash.net', 'mailzilla.com', 'mbx.cc', 'mega.zik.dj',
  'meltmail.com', 'messagebeamer.de', 'mezimages.net', 'mierdamail.com', 'mintemail.com',
  'moburl.com', 'moncourrier.fr.nf', 'monemail.fr.nf', 'monmail.fr.nf', 'mx0.wwwnew.eu',
  'mycard.net.ua', 'mycleaninbox.net', 'mypartyclip.de', 'myphantomemail.com',
  'myspaceinc.com', 'myspaceinc.net', 'myspaceinc.org', 'myspacepimpedup.com',
  'myspamless.com', 'mytrashmail.com', 'nabuma.com', 'neomailbox.com', 'nepwk.com',
  'nervmich.net', 'nervtmich.net', 'netmails.com', 'netmails.net', 'neverbox.com',
  'nincsmail.hu', 'nnh.com', 'no-spam.ws', 'noblepioneer.com', 'nobulk.com',
  'noclickemail.com', 'nogmailspam.info', 'nomail.xl.cx', 'nomail2me.com',
  'nomorespamemails.com', 'nonspam.eu', 'nonspammer.de', 'noref.in', 'nospam.ze.tc',
  'nospam4.us', 'nospamfor.us', 'nospammail.net', 'nospamthanks.info', 'notmailinator.com',
  'nowhere.org', 'nowmymail.com', 'objectmail.com', 'obobbo.com',
  'odaymail.com', 'oneoffemail.com', 'onewaymail.com', 'ordinaryamerican.net',
  'otherinbox.com', 'ovpn.to', 'owlpic.com', 'pancakemail.com', 'pjjkp.com',
  'plexolan.de', 'pookmail.com', 'politikerclub.de', 'privacy.net', 'proxymail.eu',
  'prtnx.com', 'punkass.com', 'putthisinyourspamdatabase.com', 'quickinbox.com',
  'rcpt.at', 'recode.me', 'recursor.net', 'regbypass.com', 'rejectmail.com',
  'rklips.com', 'rmqkr.net', 'rppkn.com', 'rtrtr.com', 's0ny.net', 'safersignup.de',
  'safersignup.de', 'safetymail.info', 'safetypost.de', 'sandelf.de', 'saynotospams.com',
  'selfdestructingmail.com', 'sendspamhere.com', 'sharklasers.com', 'shiftmail.com',
  'shitmail.me', 'shortmail.net', 'sibmail.com', 'skeefmail.com', 'slopsbox.com',
  'smellfear.com', 'snakemail.com', 'sneakemail.com', 'sofort-mail.de', 'sogetthis.com',
  'soodonims.com', 'spam.la', 'spam.su', 'spamavert.com', 'spambob.com', 'spambob.net',
  'spambob.org', 'spambog.com', 'spambog.de', 'spambog.ru', 'spambox.info',
  'spambox.us', 'spamcannon.com', 'spamcannon.net', 'spamcero.com', 'spamcon.org',
  'spamcorptastic.com', 'spamcowboy.com', 'spamcowboy.net', 'spamcowboy.org',
  'spamday.com', 'spamex.com', 'spamfree.eu', 'spamfree24.com', 'spamfree24.de',
  'spamfree24.org', 'spamgoes.in', 'spamgourmet.com', 'spamgourmet.net',
  'spamgourmet.org', 'spamherelots.com', 'spamhereplease.com', 'spamhole.com',
  'spamify.com', 'spaminator.de', 'spamkill.info', 'spaml.com', 'spaml.de',
  'spammotel.com', 'spamobox.com', 'spamoff.de', 'spamslicer.com', 'spamspot.com',
  'spamthis.co.uk', 'spamthisplease.com', 'spamtrail.com', 'speed.1s.fr', 'supergreatmail.com',
  'supermailer.jp', 'suremail.info', 'teewars.org', 'teleworm.com', 'teleworm.us',
  'temp-mail.org', 'temp-mail.ru', 'temp-mail.de', 'tempalias.com', 'tempe-mail.com',
  'tempemail.biz', 'tempemail.com', 'tempemail.net', 'tempinbox.com', 'tempinbox.co.uk',
  'tempmail.com', 'tempmail.de', 'tempmail.eu', 'tempmail.it', 'tempmail.net',
  'tempmail2.com', 'tempmailer.com', 'tempomail.fr', 'temporarily.de',
  'temporarioemail.com.br', 'temporaryemail.net', 'temporaryinbox.com', 'tempymail.com',
  'thanksnospam.info', 'thankyou2010.com', 'thisisnotmyrealemail.com', 'throwawayemailaddress.com',
  'tiltblog.com', 'tmailinator.com', 'tradermail.info', 'trash-mail.at', 'trash-mail.com',
  'trash-mail.de', 'trash2009.com', 'trashemail.de', 'trashmail.at', 'trashmail.com',
  'trashmail.de', 'trashmail.me', 'trashmail.net', 'trashmail.org', 'trashmail.ws',
  'trashmailer.com', 'trashymail.com', 'trashymail.net', 'trbvm.com', 'trialmail.de',
  'trillianpro.com', 'turual.com', 'twinmail.de', 'tyldd.com', 'uggsrock.com',
  'uroid.com', 'venompen.com', 'veryrealemail.com', 'viditag.com', 'viewcastmedia.com',
  'vpn.st', 'vsimcard.com', 'vubby.com', 'wasteland.rfc822.org', 'webemail.me',
  'weg-werf-email.de', 'wegwerf-emails.de', 'wegwerfadresse.de', 'wegwerfemail.com',
  'wegwerfemail.de', 'wegwerfmail.de', 'wegwerfmail.info', 'wegwerfmail.net',
  'wegwerfmail.org', 'wh4f.org', 'whyspam.me', 'willhackforfood.biz', 'willselfdestruct.com',
  'winemaven.info', 'wronghead.com', 'wuzup.net', 'www.e4ward.com', 'www.gishpuppy.com',
  'www.mailinator.com', 'xagloo.com', 'xemaps.com', 'xents.com', 'xmaily.com',
  'xoxy.net', 'yep.it', 'yogamaven.com', 'yopmail.com', 'yopmail.fr', 'yopmail.net',
  'ypmail.webarnak.fr.eu.org', 'yuurok.com', 'zehnminutenmail.de', 'zippymail.info',
  'zoaxe.com', 'zoemail.org', 'zomg.info',
  'mail.tm', 'mail.gw', 'inboxes.com', 'inboxkitten.com', 'mailsac.com',
  'emailondeck.com', 'emailnator.com', 'mohmal.com', 'mohmal.im', 'tempr.email',
  'dropmail.me', 'mail7.io', 'mailslurp.com', 'mailcatch.com', 'smailpro.com',
  'maildrop.cc', 'getnada.com', 'moakt.com', 'burnermail.io', 'addy.io', 'anonaddy.me',
  'simplelogin.com', 'simplelogin.io', '33mail.com', 'erine.email', 'spamgourmet.com',
]);

/** Части от името, които почти винаги значат „поща за еднократна употреба“. */
const DISPOSABLE_PATTERNS = [
  'tempmail', 'temp-mail', 'tempemail', 'throwaway', 'trashmail', 'trash-mail',
  'guerrilla', 'guerilla', 'mailinator', 'yopmail', '10minute', '20minute',
  'minutemail', 'getnada', 'fakeinbox', 'dispostable', 'maildrop', 'mailnesia',
  'sharklasers', 'dropmail', 'mohmal', 'burnermail', 'spam4.me', 'wegwerf',
  'one-time-email', 'onetimeemail', 'temporarymail', 'tempmailo', 'mailsac',
];

/** Еднократна поща ли е този адрес? */
export function isDisposableEmail(raw: unknown): boolean {
  const domain = emailDomain(raw);
  if (!domain) return false;
  if (DISPOSABLE_DOMAINS.has(domain)) return true;
  return DISPOSABLE_PATTERNS.some((p) => domain.includes(p));
}

/**
 * TLD-та, които са запазени и НЕ могат да приемат поща (RFC 2606 / 6761).
 * За тях не проверяваме MX — и без това оттам не може да се получи код.
 */
const RESERVED_TLDS = ['.test', '.invalid', '.localhost', '.example', '.local', '.internal', '.home', '.lan'];

export function isReservedTld(domain: string): boolean {
  return RESERVED_TLDS.some((t) => domain === t.slice(1) || domain.endsWith(t));
}

const MX_TTL_MS = 6 * 60 * 60 * 1000; // 6 часа
const mxCache = new Map<string, { ok: boolean; at: number }>();

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(Object.assign(new Error('dns timeout'), { code: 'ETIMEOUT' })), ms)),
  ]);
}

/**
 * Приема ли домейнът поща? Проверява MX записа (с резервен A запис).
 *
 * ВАЖНО: при проблем в DNS-а на СЪРВЪРА не блокираме регистрацията (иначе
 * една спънка в мрежата спира всички нови хора). Блокираме само когато
 * домейнът наистина не съществува или категорично няма записи.
 */
export async function domainAcceptsMail(domain: string): Promise<boolean> {
  if (!domain) return false;
  if (isReservedTld(domain)) return true;

  const cached = mxCache.get(domain);
  if (cached && Date.now() - cached.at < MX_TTL_MS) return cached.ok;

  let ok: boolean;
  try {
    const mx = await withTimeout(dns.resolveMx(domain), 3000);
    ok = Array.isArray(mx) && mx.length > 0;
    if (!ok) {
      const a = await withTimeout(dns.resolve4(domain), 3000);
      ok = Array.isArray(a) && a.length > 0;
    }
  } catch (err) {
    const code = (err as { code?: string }).code;
    // Няма такъв домейн / няма записи → не може да получи код.
    ok = !(code === 'ENOTFOUND' || code === 'ENODATA' || code === 'ESERVFAIL');
  }

  mxCache.set(domain, { ok, at: Date.now() });
  return ok;
}
