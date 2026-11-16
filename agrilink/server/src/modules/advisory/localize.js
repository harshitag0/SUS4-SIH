import { LANGS, PLAYBOOK } from "./knowledge.js";
import { MORE_REASONS } from "./knowledge_more.js";

/** Reason sentences (built from the evidence that raised the gap), in the farmer's language. */
const REASON = {
  measured_blemish: {
    en: "Photo check on {date} measured {value}% blemished skin; buyer's Grade {grade} allows at most {max}%.",
    hi: "{date} की फ़ोटो जाँच में {value}% छिलके पर दाग़ मापे गए; खरीदार का ग्रेड {grade} ज़्यादा से ज़्यादा {max}% मानता है।",
    mr: "{date} च्या फोटो तपासणीत {value}% सालीवर डाग मोजले; खरेदीदाराचा ग्रेड {grade} जास्तीत जास्त {max}% मान्य करतो.",
  },
  measured_colour: {
    en: "Photo check on {date} measured colour score {value}; Grade {grade} needs at least {min} at collection.",
    hi: "{date} की फ़ोटो जाँच में रंग स्कोर {value} मापा गया; ग्रेड {grade} को इकट्ठा करते समय कम से कम {min} चाहिए।",
    mr: "{date} च्या फोटो तपासणीत रंग गुण {value} मोजला; ग्रेड {grade} साठी संकलनावेळी किमान {min} हवा.",
  },
  flag_ai: { en: "AgriLink's photo analysis flagged this on {date}. It must be confirmed by your farmer doctor.", hi: "{date} को AgriLink फ़ोटो विश्लेषण ने यह चिह्नित किया। फ़ार्मर डॉक्टर से पुष्टि ज़रूरी है।", mr: "{date} रोजी AgriLink फोटो विश्लेषणाने हे नोंदवले. फार्मर डॉक्टरकडून खात्री आवश्यक आहे." },
  flag_doctor: { en: "Your farmer doctor recorded this during the visit on {date}.", hi: "{date} की विज़िट में फ़ार्मर डॉक्टर ने यह दर्ज किया।", mr: "{date} च्या भेटीत फार्मर डॉक्टरने हे नोंदवले." },
  farmer_reported: { en: "From your own record for the \"{stage}\" stage.", hi: "\"{stage}\" चरण के आपके अपने रिकॉर्ड से।", mr: "\"{stage}\" टप्प्याच्या तुमच्या स्वतःच्या नोंदीवरून." },
  review_fail: { en: "The latest quality review for your contract did not pass.", hi: "आपके अनुबंध की ताज़ा गुणवत्ता समीक्षा पास नहीं हुई।", mr: "तुमच्या कराराचे ताजे गुणवत्ता पुनरावलोकन पास झाले नाही." },
  consultant: { en: "Your farmer doctor reviewed the \"{stage}\" stage and asked for a correction.", hi: "फ़ार्मर डॉक्टर ने \"{stage}\" चरण की समीक्षा करके सुधार माँगा।", mr: "फार्मर डॉक्टरने \"{stage}\" टप्प्याचे पुनरावलोकन करून दुरुस्ती मागितली." },
  retake: { en: "{n} photo check(s) needed a retake because the photos were not clear.", hi: "{n} फ़ोटो जाँच में फ़ोटो साफ़ न होने से दोबारा लेनी पड़ी।", mr: "{n} फोटो तपासणीत फोटो स्पष्ट नसल्याने पुन्हा घ्यावे लागले." },
  missed: { en: "{n} photo check(s) are missed or overdue.", hi: "{n} फ़ोटो जाँच छूटी या बाकी हैं।", mr: "{n} फोटो तपासण्या चुकल्या किंवा बाकी आहेत." },
  readiness: { en: "Harvest window opens in {days} day(s); your quality status is {status}.", hi: "तुड़ाई {days} दिन में शुरू; आपकी गुणवत्ता स्थिति {status} है।", mr: "तोडणी {days} दिवसांत सुरू; तुमची गुणवत्ता स्थिती {status} आहे." },
  weather: { en: "Live forecast for your district: rain {rain} mm in 48 h, wind {wind} km/h, {temp}°C.", hi: "आपके ज़िले का लाइव अनुमान: 48 घंटे में {rain} मिमी बारिश, हवा {wind} किमी/घं, {temp}°C।", mr: "तुमच्या जिल्ह्याचा थेट अंदाज: 48 तासांत {rain} मिमी पाऊस, वारा {wind} किमी/तास, {temp}°C." },
};

for (const [k, v] of Object.entries(MORE_REASONS)) Object.assign(REASON[k], v);

const fill = (s, p = {}) => s.replace(/\{(\w+)\}/g, (_, k) => (p[k] ?? "—"));

export function localize(item, lang = "en") {
  const L = LANGS.includes(lang) ? lang : "en";
  const p = PLAYBOOK[item.code][L] || PLAYBOOK[item.code].en;
  const r = REASON[item.reason?.type];
  return { ...item, lang: L, problem: p.problem, reason: r ? fill(r[L] || r.en, item.reason.params) : null, action: p.action, steps: p.steps, expected: p.expected };
}
