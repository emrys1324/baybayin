/* English / Tagalog for the customer site. Keys are the English text; missing keys fall back to English.
   I18N.t(text, vars)  -> translated text with {var} placeholders filled
   I18N.tx(text)       -> translate dynamic text from the server/shared code (errors, price labels) */
(function () {
  'use strict';
  var TL = {
    // landing
    'Book a Scooter': 'Mag-book ng Scooter',
    '{open} – {close} daily': '{open} – {close} araw-araw',
    'Helmet included': 'Kasama ang helmet',
    'Cash or GCash': 'Cash o GCash',
    'Our scooters': 'Aming mga scooter',
    'from': 'mula',
    'Refundable deposit {deposit}. Multi-day discounts for {days}+ days.': 'Refundable deposit na {deposit}. May discount kapag {days} araw pataas.',
    'Photos': 'Mga larawan',
    'Shop photo': 'Larawan ng shop',
    'Find us': 'Paano kami puntahan',
    'Pickup & return': 'Pickup at balik',
    '{open} – {close}, every day': '{open} – {close}, araw-araw',
    'Coming by ferry or RoRo?': 'Darating sakay ng barko o RoRo?',
    'Add port delivery and we\'ll meet you there.': 'Piliin ang port delivery at sasalubungin ka namin doon.',
    'Directions': 'Direksyon',
    'Find my booking': 'Hanapin ang booking ko',
    'Rental terms': 'Mga patakaran sa pag-rent',
    'Got it': 'Sige',
    'Salamat po sa pagbisita!': 'Salamat po sa pagbisita!',
    // steps
    'When': 'Kailan', 'Scooter': 'Scooter', 'Extras': 'Extras', 'Your details': 'Detalye mo', 'Payment': 'Bayad',
    'Step {n} of {total}': 'Hakbang {n} sa {total}',
    'Total': 'Kabuuan',
    'Back': 'Bumalik',
    'When do you need it?': 'Kailan mo kailangan?',
    'Pickup & return at our shop, {open} – {close} (Philippine time).': 'Pickup at balik sa aming shop, {open} – {close} (oras sa Pilipinas).',
    'Pickup': 'Pickup', 'Return': 'Balik',
    'Pickup date': 'Petsa ng pickup', 'Pickup time': 'Oras ng pickup', 'Return date': 'Petsa ng balik', 'Return time': 'Oras ng balik',
    'How long?': 'Gaano katagal?',
    'Half day': 'Kalahating araw', '1 day': '1 araw', '2 days': '2 araw', '3 days': '3 araw', '1 week': '1 linggo',
    'See scooters': 'Tingnan ang scooters',
    'Rental length:': 'Haba ng renta:',
    'Checking…': 'Tinitingnan…',
    'Choose your scooter': 'Pumili ng scooter',
    'All scooters are booked for these dates. Try different dates or message us on Messenger.': 'Booked na lahat ng scooter sa mga petsang ito. Subukan ang ibang petsa o mag-message sa amin sa Messenger.',
    '1 left': '1 na lang', '{n} available': '{n} available', 'Booked': 'Booked na',
    'Change dates': 'Palitan ang petsa',
    'Continue': 'Tuloy',
    'Tap a scooter': 'Pumili ng scooter',
    // price
    'Rental total': 'Kabuuang renta',
    'Refundable deposit': 'Refundable deposit',
    'paid in cash at pickup, returned after': 'cash sa pickup, ibabalik pagkatapos',
    'Bring at pickup': 'Dalhin sa pickup',
    '(deposit only)': '(deposit lang)',
    'Add extras': 'Magdagdag ng extras',
    '/ day': '/ araw',
    'Less': 'Bawasan', 'More': 'Dagdagan',
    'Price breakdown': 'Detalye ng presyo',
    'One helmet is included. Riding with a passenger? Add an extra helmet.': 'May kasamang isang helmet. May angkas ka? Magdagdag ng extra helmet.',
    'Extra helmet': 'Extra helmet', 'Phone holder': 'Phone holder', 'Delivery to port / resort': 'Hatid sa port / resort',
    // details
    'Full name': 'Buong pangalan',
    'Mobile number': 'Mobile number',
    'Foreign number? Start with + and country code.': 'Foreign number? Simulan sa + at country code.',
    'Facebook / Messenger name': 'Pangalan sa Facebook / Messenger',
    'So we can message you': 'Para ma-message ka namin',
    'Where are you staying?': 'Saan ka tutuloy?',
    'Resort, homestay or barangay': 'Resort, homestay o barangay',
    'Arriving by ferry': 'Darating sakay ng barko', 'Arriving by RoRo': 'Darating sakay ng RoRo',
    'San Agustin town': 'Bayan ng San Agustin', 'Local resident': 'Taga-rito',
    'Email': 'Email', '(optional)': '(opsyonal)',
    'Number of riders': 'Ilang sasakay',
    '1 rider': '1 sakay', '{n} riders': '{n} sakay',
    'Driver\'s license photo': 'Litrato ng driver\'s license',
    'Tap to take or upload a photo of your license': 'I-tap para kunan o i-upload ang litrato ng lisensya mo',
    'Clear photo of the front side. Bring the original at pickup.': 'Malinaw na litrato ng harap. Dalhin ang original sa pickup.',
    'I agree to the {terms} (license, helmet, damage, fuel, late fees, cancellation).': 'Sang-ayon ako sa {terms} (lisensya, helmet, sira, gasolina, late fee, pag-cancel).',
    'rental terms': 'mga patakaran sa pag-rent',
    'Continue to payment': 'Tuloy sa bayad',
    'Tip: add an extra helmet for your passenger': 'Tip: magdagdag ng extra helmet para sa angkas mo',
    'Please enter your full name.': 'Pakilagay ang buong pangalan mo.',
    'Please enter a valid mobile number (e.g. 0917 123 4567).': 'Pakilagay ang tamang mobile number (hal. 0917 123 4567).',
    'Please check your email address.': 'Pakitingnan ang email address mo.',
    'Please add a photo of your driver\'s license.': 'Pakilagay ang litrato ng driver\'s license mo.',
    'Please upload a photo of your driver\'s license.': 'Pakilagay ang litrato ng driver\'s license mo.',
    'Please agree to the rental terms.': 'Pakisang-ayunan ang mga patakaran sa pag-rent.',
    'Photo added · tap to change': 'Naidagdag na ang litrato · i-tap para palitan',
    'Compressing photo…': 'Pinapaliit ang litrato…',
    'Preview': 'Preview',
    // payment
    'Pay at pickup (cash)': 'Bayad sa pickup (cash)',
    'Pay via GCash': 'Bayad via GCash',
    'Send {amount} to:': 'Ipadala ang {amount} sa:',
    'Copy number': 'Kopyahin ang number',
    'GCash reference number': 'GCash reference number',
    'e.g. 1009 123 456789': 'hal. 1009 123 456789',
    'Payment screenshot': 'Screenshot ng bayad',
    'Upload GCash screenshot': 'I-upload ang GCash screenshot',
    'GCash QR code': 'GCash QR code',
    'Pay the rental and deposit in cash when you pick up your scooter.': 'Bayaran ang renta at deposit nang cash pagkuha mo ng scooter.',
    'Summary': 'Buod',
    'Confirm booking': 'Kumpirmahin ang booking',
    'Sending…': 'Ipinapadala…',
    'Please enter your GCash reference number.': 'Pakilagay ang GCash reference number mo.',
    'Please upload your GCash payment screenshot.': 'Paki-upload ang screenshot ng GCash payment mo.',
    'Please add your license photo again': 'Pakilagay ulit ang litrato ng lisensya mo',
    // confirmation & lookup
    'Refundable deposit (at pickup)': 'Refundable deposit (sa pickup)',
    'Payment:': 'Bayad:',
    'GCash (we\'ll verify your reference)': 'GCash (ive-verify namin ang reference mo)',
    'Cash at pickup': 'Cash sa pickup',
    'Status:': 'Status:',
    'Pending': 'Naghihintay ng kumpirmasyon', 'Confirmed': 'Kumpirmado', 'Picked Up': 'Nakuha na',
    'Returned': 'Naibalik na', 'Cancelled': 'Kinansela',
    'Hi! I just booked {ref} ({model}, {when}).': 'Hi! Nag-book ako ng {ref} ({model}, {when}).',
    'Salamat, {name}!': 'Salamat, {name}!',
    'Your booking request is in. Your reference code:': 'Natanggap na namin ang booking mo. Ang reference code mo:',
    'We\'ll confirm on Messenger or SMS shortly. Screenshot this page for easy reference.': 'Kukumpirmahin namin agad sa Messenger o SMS. I-screenshot ang page na ito para madaling balikan.',
    'Message us on Messenger': 'Mag-message sa amin sa Messenger',
    'Pickup point': 'Lugar ng pickup',
    'Get directions': 'Direksyon papunta',
    'Don\'t forget your original driver\'s license and {deposit} cash deposit. Ingat sa biyahe!': 'Huwag kalimutan ang original na driver\'s license at {deposit} na cash deposit. Ingat sa biyahe!',
    'Back to home': 'Bumalik sa home',
    'Booking reference': 'Booking reference',
    'Mobile number used': 'Mobile number na ginamit',
    'Find booking': 'Hanapin',
    'Message us': 'Mag-message sa amin',
    // errors from the server / network
    'No booking found with that reference and mobile number.': 'Walang nahanap na booking sa reference at mobile number na iyan.',
    'Sorry, that scooter was just booked for those dates. Please pick another one.': 'Pasensya na, kaka-book lang ng scooter na iyan sa mga petsang iyan. Pumili ng iba.',
    'No connection. Please check your signal and try again.': 'Walang koneksyon. Tingnan ang signal mo at subukan ulit.',
    'Network error, please try again.': 'May problema sa network, subukan ulit.',
    'Something went wrong. Please try again.': 'Nagka-problema. Pakisubukan ulit.',
    'Online booking is being set up. Please message us on Facebook Messenger to book.': 'Inaayos pa ang online booking. Mag-message sa amin sa Facebook Messenger para mag-book.',
    'Try again': 'Subukan ulit',
    'Copied!': 'Nakopya!',
    'Please choose pickup and return date & time.': 'Pumili ng petsa at oras ng pickup at balik.',
    'Return must be after pickup.': 'Dapat mas huli ang balik kaysa sa pickup.',
    'Please choose a photo (JPG or PNG).': 'Pumili ng litrato (JPG o PNG).',
    'Could not read that photo. Try another one.': 'Hindi mabasa ang litratong iyan. Subukan ang iba.',
    // language toggle
    'Switch language': 'Palitan ang wika'
  };

  // Dynamic messages built elsewhere (shared.js validation, price labels, durations).
  var PATTERNS = [
    [/^Pickup must be between (.+) and (.+)\.$/, 'Ang pickup ay dapat mula $1 hanggang $2.'],
    [/^Return must be between (.+) and (.+)\.$/, 'Ang balik ay dapat mula $1 hanggang $2.'],
    [/^Pickup needs to be at least (\d+) minutes from now\.$/, 'Ang pickup ay dapat hindi bababa sa $1 minuto mula ngayon.'],
    [/^Minimum rental is (\d+) hours\.$/, 'Ang pinakamaikling renta ay $1 oras.'],
    [/^For rentals longer than (\d+) days, please message us\.$/, 'Para sa rentang lampas $1 araw, mag-message sa amin.'],
    [/^Half-day \(up to (\d+) hrs\)$/, 'Kalahating araw (hanggang $1 oras)'],
    [/^(\d+) days? × (₱[\d,]+) \(multi-day rate\)$/, '$1 araw × $2 (multi-day rate)'],
    [/^(\d+) days? × (₱[\d,]+)$/, '$1 araw × $2'],
    [/^(\d+) days? (\d+) hrs$/, '$1 araw $2 oras'],
    [/^(\d+) days?$/, '$1 araw'],
    [/^([\d.]+) hrs$/, '$1 oras']
  ];

  var lang = 'en';
  try { lang = localStorage.getItem('bay_lang') || ''; } catch (e) {}
  if (lang !== 'en' && lang !== 'tl') lang = /^(fil|tl)\b/i.test(navigator.language || '') ? 'tl' : 'en';

  function fill(s, vars) {
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return k in vars ? vars[k] : m; }) : s;
  }
  function t(s, vars) { return fill(lang === 'tl' && TL[s] ? TL[s] : s, vars); }
  function tx(s) {
    if (lang !== 'tl' || !s) return s;
    if (TL[s]) return TL[s];
    for (var i = 0; i < PATTERNS.length; i++) if (PATTERNS[i][0].test(s)) return s.replace(PATTERNS[i][0], PATTERNS[i][1]);
    return s;
  }
  function setLang(l) {
    lang = l === 'tl' ? 'tl' : 'en';
    try { localStorage.setItem('bay_lang', lang); } catch (e) {}
    document.documentElement.lang = lang === 'tl' ? 'tl' : 'en';
  }
  document.documentElement.lang = lang === 'tl' ? 'tl' : 'en';

  window.I18N = { t: t, tx: tx, setLang: setLang, get lang() { return lang; }, TL: TL };
})();
