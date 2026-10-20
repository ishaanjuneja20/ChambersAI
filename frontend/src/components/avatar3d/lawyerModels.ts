// Lawyers that have a 3D avatar on the consultation screen. Everyone else keeps the 2D portrait.
// Ananya Iyer (constitutional), Priya Menon (property), Karan Oberoi (labour), Arjun Shah (consumer) and
// Meera Iyer (family). All
// GLBs share the same Ready Player Me rig and ARKit blendshapes, so framing, arm pose (IK from each model's
// own bone lengths), visemes and face animation are shared.
export interface LawyerModel {
  modelUrl: string;
  backgroundUrl: string;
  fishVoice: boolean; // speak with the backend's Fish Audio voice + lip-sync timing when VITE_TTS_API_URL is set
}

const base = import.meta.env.BASE_URL;

const LAWYER_MODELS: Record<string, LawyerModel> = {
  constitutional: {
    modelUrl: `${base}${encodeURI("brand/assets/lawyers/Ananaya Iyer.glb")}`,
    backgroundUrl: `${base}assets/courtroom-background.png`,
    fishVoice: true,
  },
  property: {
    modelUrl: `${base}brand/assets/lawyers/priya_menon.glb`,
    backgroundUrl: `${base}assets/courtroom-background.png`,
    fishVoice: true, // backend/lawyers.py "property"
  },
  labour: {
    modelUrl: `${base}${encodeURI("brand/assets/lawyers/Karan oberoy.glb")}`,
    backgroundUrl: `${base}assets/courtroom-background.png`,
    fishVoice: true, // backend/lawyers.py "labour" (male voice)
  },
  consumer: {
    modelUrl: `${base}brand/assets/lawyers/ArjunShah.glb`,
    backgroundUrl: `${base}assets/courtroom-background.png`,
    fishVoice: true, // backend/lawyers.py "consumer" (male voice)
  },
  family: {
    modelUrl: `${base}brand/assets/lawyers/MeeraIyer.glb`,
    backgroundUrl: `${base}assets/courtroom-background.png`,
    fishVoice: true, // backend/lawyers.py "family"
  },
};

export function getLawyerModel(lawyerId: string): LawyerModel | undefined {
  return LAWYER_MODELS[lawyerId];
}

export function usesFishVoice(lawyerId: string): boolean {
  return !!LAWYER_MODELS[lawyerId]?.fishVoice;
}
