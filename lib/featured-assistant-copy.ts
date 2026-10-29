import { FEATURED_ASSISTANTS } from "./featured-assistants";
import type { AssistantProvider } from "./featured-assistants";
import type { Locale } from "./i18n";
import { FEATURED_ASSISTANT_TRANSLATIONS } from "./featured-assistant-locales";
import type { FeaturedAssistantCopy } from "./featured-assistant-locales";

const english: Record<AssistantProvider, FeaturedAssistantCopy> = {
  grok: {
    title: "From a question to a clearer understanding",
    description: "Organize an idea, understand a topic, or compare your options with Grok.",
    capability: "Text assistance with Grok",
    distinction: "This connection uses the Grok model. Grok Bot memory, computer access, and connections belong to its official app and are not included here.",
    steps: ["Create an API key in the xAI developer console and check your credits and usage limits.", "Paste your key here, describe your task, and select Run assistant.", "For the full Grok Bot, follow the official app guide, sign in with an eligible plan, and grant only the permissions you need."],
    example: "Compare three ways to study a difficult course. Explain when each method is useful, then suggest a practical weekly plan.",
  },
  meta: {
    title: "A space to organize your ideas",
    description: "Turn your notes into a clear plan or a simple explanation with Muse Spark.",
    capability: "Text assistance with Muse Spark",
    distinction: "This connection uses Muse Spark. The personal Muse agent and connected services are available through its official site; availability depends on your region and account.",
    steps: ["Open the Meta developer platform, check model API access for your account, and create a key.", "Enter your key here to run a text task with Muse Spark.", "For the personal agent, open Muse and complete account setup. For coding in a terminal, see the Muse Code developer documentation."],
    example: "Turn this idea into a university project plan: a tool that helps students organize sources. Suggest weekly milestones and clear deliverables.",
  },
  manus: {
    title: "A task that moves forward, step by step",
    description: "Send a multi-step task to Manus and follow its progress and result here.",
    capability: "Create and track Manus tasks",
    distinction: "This connection runs tasks through the Manus API. Cue is a separate personal app that may require an invitation; a Manus key does not automatically provide all Cue features.",
    steps: ["Create a key in a Manus account with API access and check your task credits.", "Describe your goal and expected output, then run the task here. Tasks are created with private sharing.", "Select Refresh task status to follow progress. If the agent needs an answer or approval, open the official task and respond yourself.", "For the personal Cue service, open the official announcement and follow the access link available to your account."],
    example: "Research free tools for organizing academic references using official sources. Compare them in a table with source links and suggest a beginner-friendly option. Do not create accounts or purchase anything.",
  },
  openai: {
    title: "Help that fits your task",
    description: "Review writing, simplify a concept, or build a study or work plan with an OpenAI model.",
    capability: "Text assistance with OpenAI",
    distinction: "This assistant uses the OpenAI API, not your ChatGPT dot. Your personal dot, its memory, and tools are set up in ChatGPT, depending on your plan and region.",
    steps: ["Create an OpenAI developer API key and check your API credits. A ChatGPT subscription does not automatically include API credits.", "Enter your key and task here. The response appears in Hessara and can be copied.", "To create your personal dot, follow the official setup guide in ChatGPT on the desktop web or desktop app, using the options available to your account."],
    example: "Explain how to choose an AI model for reviewing a university paper. Give simple criteria and five small tasks for checking quality without inventing references.",
  },
};

export function featuredAssistants(locale: Locale) {
  if (locale === "ar") return FEATURED_ASSISTANTS;
  const translations = locale === "en" ? english : FEATURED_ASSISTANT_TRANSLATIONS[locale];
  return FEATURED_ASSISTANTS.map(item => {
    return { ...item, ...translations[item.id] };
  });
}
