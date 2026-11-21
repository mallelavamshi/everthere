# Material use of AI tools

Answer for the submission form question "Describe any material use of AI tools in your submission".

---

**Inside the product (what judges use when they run it)**

- **Napster:** the live talking avatars, agents, function calling (`flag_concern`), FAQs and knowledge base. Each conversation runs on Azure OpenAI realtime through Napster. Mia's Daddy is my own Napster digital twin: my real face and a clone of my voice, made with my consent.
- **Meta `muse-spark-1.3`:** after each call it writes the parent's two-line summary, a mood signal, and a second sweep for safety concerns the live tool missed.
- **Meta `muse-image-1.0`:** all of the app's illustrations and the demo family's portraits. The app icon is plain vector art drawn in code. Every demo face except mine is AI-generated and is labelled that way.

**Building it**

- **Claude Code (Anthropic):** an AI coding assistant, used heavily throughout. It wrote and refactored most of the code, tests, docs and deploy scripts, and drove the automated end-to-end checks. I set the product direction, the safety rules and the design. I reviewed the work, tested it on real devices, and made the final decisions.

**The demo video**

- It is a real screen recording of the real app and a live Napster call. The avatar's voice is the real call audio.
- The child's lines are text-to-speech: Microsoft edge-tts, the en-US-AnaNeural voice. They were played aloud into the phone's microphone during the live call. The video says so on screen.
- The edit and captions were made in Remotion, which is not AI.
- The promo clips use Meta muse-image scenes, animated with Wan 2.2 image-to-video on a Modal GPU. The phone screens in them are real app recordings.
- The music is a free Mixkit track, not AI-generated.

No real child appears anywhere in the submission.
