// LK888 media model profiles, independently implemented from the project's
// protocol reference. Source checked 2026-10-14:
// https://github.com/Corkery520/ComfyUI-MengBaoAI/blob/main/nodes/image_api/generate.py
// These are exact API IDs, not matches inferred from model names.
const PROFILES={
 "banana-2": {
  "qualities": [
   "0.5K",
   "1K",
   "2K",
   "4K"
  ],
  "ratios": [
   "1:1",
   "2:3",
   "3:2",
   "3:4",
   "4:3",
   "4:5",
   "5:4",
   "9:16",
   "16:9",
   "21:9",
   "1:4",
   "4:1",
   "1:8",
   "8:1"
  ],
  "qualityField": "imageSize",
  "ratioField": "aspectRatio",
  "defaults": {
   "thinkingLevel": "minimal",
   "n": 1
  },
  "maxImages": 14
 },
 "banana-pro": {
  "qualities": [
   "1K",
   "2K",
   "4K"
  ],
  "ratios": [
   "1:1",
   "2:3",
   "3:2",
   "3:4",
   "4:3",
   "4:5",
   "5:4",
   "9:16",
   "16:9",
   "21:9"
  ],
  "qualityField": "imageSize",
  "ratioField": "aspectRatio",
  "defaults": {
   "n": 1
  },
  "maxImages": 14
 },
 "tt-image-2": {
  "qualities": [
   "1K",
   "2K",
   "4K"
  ],
  "ratios": [
   "1:1",
   "2:3",
   "3:2",
   "3:4",
   "4:3",
   "9:16",
   "16:9",
   "4:5",
   "5:4",
   "1:2",
   "2:1"
  ],
  "sizes": {
   "1K": {
    "1:1": "1024x1024",
    "2:3": "1024x1536",
    "3:2": "1536x1024",
    "3:4": "960x1280",
    "4:3": "1280x960",
    "9:16": "1088x1920",
    "16:9": "1920x1088",
    "4:5": "1024x1280",
    "5:4": "1280x1024",
    "1:2": "960x1920",
    "2:1": "1920x960"
   },
   "2K": {
    "1:1": "2048x2048",
    "2:3": "2048x3072",
    "3:2": "3072x2048",
    "3:4": "1920x2560",
    "4:3": "2560x1920",
    "9:16": "1440x2560",
    "16:9": "2560x1440",
    "4:5": "2048x2560",
    "5:4": "2560x2048",
    "1:2": "1280x2560",
    "2:1": "2560x1280"
   },
   "4K": {
    "1:1": "2880x2880",
    "2:3": "2304x3456",
    "3:2": "3456x2304",
    "3:4": "2400x3200",
    "4:3": "3200x2400",
    "9:16": "2160x3840",
    "16:9": "3840x2160",
    "4:5": "2560x3200",
    "5:4": "3200x2560",
    "1:2": "1920x3840",
    "2:1": "3840x1920"
   }
  },
  "defaults": {
   "quality": "auto",
   "n": 1
  },
  "maxImages": 14
 },
 "tt-image-2.5": {
  "qualities": [
   "1K",
   "2K",
   "4K"
  ],
  "ratios": [
   "1:1",
   "16:9",
   "9:16",
   "4:3",
   "3:4",
   "3:2",
   "2:3",
   "5:4",
   "4:5",
   "2:1",
   "1:2",
   "21:9",
   "9:21"
  ],
  "qualityField": "resolution",
  "ratioField": "aspect_ratio",
  "defaults": {
   "version": "flare",
   "quality": "auto",
   "background": "opaque",
   "n": 1
  },
  "maxImages": 16
 }
};
function platformProfile(model){return model&&!model.hasSchema?PROFILES[model.id]||null:null;}
function platformImageLimit(id){return PROFILES[id]?.maxImages||null;}
function platformParams(profile,{quality,ratio,includeRatio=true}){
 if(!profile.qualities.includes(quality))throw new Error('该模型不支持清晰度 '+quality+'。');
 if(includeRatio&&!profile.ratios.includes(ratio))throw new Error('该模型不支持比例 '+ratio+'。');
 const params={...profile.defaults};
 if(profile.sizes){
  params.size=includeRatio?profile.sizes[quality]?.[ratio]:'auto';
  if(!params.size)throw new Error('该模型没有与当前清晰度和比例匹配的像素尺寸。');
 }else if(includeRatio){params[profile.qualityField]=quality;params[profile.ratioField]=ratio;}
 else if(profile.qualityField==='resolution'){params.resolution='auto';params.aspect_ratio='auto';}
 else params[profile.qualityField]=quality;
 return params;
}
module.exports={platformProfile,platformImageLimit,platformParams};
