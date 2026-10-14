// Public platform parameter snapshot, checked 2026-10-14.
// Source: https://eat.lk888.ai/apidoc (base_url confirmed as https://api.lk888.ai).
// Only model IDs, labels, parameter fields and option values are retained.
module.exports=[
 {
  "name": "banana-2-token",
  "display_name": "纳米香蕉 2 Token版",
  "type": "image",
  "tags": [
   "文生图",
   "图生图",
   "4k",
   "高清",
   "香蕉",
   "官转直连",
   "联网搜索"
  ],
  "api_format": "media",
  "params": [
   {
    "name": "images",
    "label": "参考图片",
    "type": "upload",
    "required": false,
    "max_count": 11
   },
   {
    "name": "aspectRatio",
    "label": "图片比例",
    "type": "select",
    "required": true,
    "options": [
     {
      "value": "1:1",
      "label": "1:1 正方形"
     },
     {
      "value": "2:3",
      "label": "2:3 竖版"
     },
     {
      "value": "3:2",
      "label": "3:2 横版"
     },
     {
      "value": "3:4",
      "label": "3:4 竖版"
     },
     {
      "value": "4:3",
      "label": "4:3 横版"
     },
     {
      "value": "4:5",
      "label": "4:5 竖版"
     },
     {
      "value": "5:4",
      "label": "5:4 横版"
     },
     {
      "value": "9:16",
      "label": "9:16 竖屏"
     },
     {
      "value": "16:9",
      "label": "16:9 横屏"
     },
     {
      "value": "21:9",
      "label": "21:9 超宽屏"
     },
     {
      "value": "1:4",
      "label": "1:4 超竖版"
     },
     {
      "value": "4:1",
      "label": "4:1 超横版"
     },
     {
      "value": "1:8",
      "label": "1:8 极竖版"
     },
     {
      "value": "8:1",
      "label": "8:1 极横版"
     }
    ]
   },
   {
    "name": "imageSize",
    "label": "分辨率",
    "type": "select",
    "required": true,
    "options": [
     {
      "value": "0.5K",
      "label": "0.5K 极速"
     },
     {
      "value": "1K",
      "label": "1K 标清"
     },
     {
      "value": "2K",
      "label": "2K 高清"
     },
     {
      "value": "4K",
      "label": "4K 超清"
     }
    ]
   },
   {
    "name": "thinkingLevel",
    "label": "思考等级",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "minimal",
      "label": "快速"
     },
     {
      "value": "high",
      "label": "深度"
     }
    ]
   }
  ],
  "source": "platform-docs-2026-10-14"
 },
 {
  "name": "banana-2.1-token",
  "display_name": "纳米香蕉 2.1 官转",
  "type": "image",
  "tags": [
   "文生图",
   "图生图",
   "4k",
   "高清",
   "香蕉",
   "官转直连",
   "联网搜索"
  ],
  "api_format": "media",
  "params": [
   {
    "name": "images",
    "label": "参考图片",
    "type": "upload",
    "required": false,
    "max_count": 14
   },
   {
    "name": "aspectRatio",
    "label": "图片比例",
    "type": "select",
    "required": true,
    "options": [
     {
      "value": "1:1",
      "label": "1:1 正方形"
     },
     {
      "value": "2:3",
      "label": "2:3 竖版"
     },
     {
      "value": "3:2",
      "label": "3:2 横版"
     },
     {
      "value": "3:4",
      "label": "3:4 竖版"
     },
     {
      "value": "4:3",
      "label": "4:3 横版"
     },
     {
      "value": "4:5",
      "label": "4:5 竖版"
     },
     {
      "value": "5:4",
      "label": "5:4 横版"
     },
     {
      "value": "9:16",
      "label": "9:16 竖屏"
     },
     {
      "value": "16:9",
      "label": "16:9 横屏"
     },
     {
      "value": "21:9",
      "label": "21:9 超宽屏"
     },
     {
      "value": "1:4",
      "label": "1:4 超竖版"
     },
     {
      "value": "4:1",
      "label": "4:1 超横版"
     },
     {
      "value": "1:8",
      "label": "1:8 极竖版"
     },
     {
      "value": "8:1",
      "label": "8:1 极横版"
     }
    ]
   },
   {
    "name": "imageSize",
    "label": "分辨率",
    "type": "select",
    "required": true,
    "options": [
     {
      "value": "1K",
      "label": "1K 标清"
     },
     {
      "value": "2K",
      "label": "2K 高清"
     },
     {
      "value": "4K",
      "label": "4K 超清"
     }
    ]
   },
   {
    "name": "thinkingLevel",
    "label": "思考等级",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "minimal",
      "label": "快速"
     },
     {
      "value": "high",
      "label": "深度"
     }
    ]
   }
  ],
  "source": "platform-docs-2026-10-14"
 },
 {
  "name": "banana-2.1",
  "display_name": "纳米香蕉 2.1 按次",
  "type": "image",
  "tags": [
   "文生图",
   "图生图",
   "4k",
   "高清",
   "香蕉",
   "联网搜索"
  ],
  "api_format": "media",
  "params": [
   {
    "name": "images",
    "label": "参考图片",
    "type": "upload",
    "required": false,
    "max_count": 14
   },
   {
    "name": "aspectRatio",
    "label": "图片比例",
    "type": "select",
    "required": true,
    "options": [
     {
      "value": "1:1",
      "label": "1:1 正方形"
     },
     {
      "value": "2:3",
      "label": "2:3 竖版"
     },
     {
      "value": "3:2",
      "label": "3:2 横版"
     },
     {
      "value": "3:4",
      "label": "3:4 竖版"
     },
     {
      "value": "4:3",
      "label": "4:3 横版"
     },
     {
      "value": "4:5",
      "label": "4:5 竖版"
     },
     {
      "value": "5:4",
      "label": "5:4 横版"
     },
     {
      "value": "9:16",
      "label": "9:16 竖屏"
     },
     {
      "value": "16:9",
      "label": "16:9 横屏"
     },
     {
      "value": "21:9",
      "label": "21:9 超宽屏"
     },
     {
      "value": "1:4",
      "label": "1:4 超竖版"
     },
     {
      "value": "4:1",
      "label": "4:1 超横版"
     },
     {
      "value": "1:8",
      "label": "1:8 极竖版"
     },
     {
      "value": "8:1",
      "label": "8:1 极横版"
     }
    ]
   },
   {
    "name": "imageSize",
    "label": "分辨率",
    "type": "select",
    "required": true,
    "options": [
     {
      "value": "1K",
      "label": "1K 标清"
     },
     {
      "value": "2K",
      "label": "2K 高清"
     },
     {
      "value": "4K",
      "label": "4K 超清"
     }
    ]
   },
   {
    "name": "thinkingLevel",
    "label": "思考等级",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "minimal",
      "label": "快速"
     },
     {
      "value": "high",
      "label": "深度"
     }
    ]
   }
  ],
  "source": "platform-docs-2026-10-14"
 },
 {
  "name": "banana-2",
  "display_name": "纳米香蕉 2",
  "type": "image",
  "tags": [
   "文生图",
   "图生图",
   "4k",
   "高清",
   "香蕉"
  ],
  "api_format": "media",
  "params": [
   {
    "name": "images",
    "label": "参考图片",
    "type": "upload",
    "required": false,
    "max_count": 14
   },
   {
    "name": "aspectRatio",
    "label": "图片比例",
    "type": "select",
    "required": true,
    "options": [
     {
      "value": "1:1",
      "label": "1:1 正方形"
     },
     {
      "value": "2:3",
      "label": "2:3 竖版"
     },
     {
      "value": "3:2",
      "label": "3:2 横版"
     },
     {
      "value": "3:4",
      "label": "3:4 竖版"
     },
     {
      "value": "4:3",
      "label": "4:3 横版"
     },
     {
      "value": "4:5",
      "label": "4:5 竖版"
     },
     {
      "value": "5:4",
      "label": "5:4 横版"
     },
     {
      "value": "9:16",
      "label": "9:16 竖屏"
     },
     {
      "value": "16:9",
      "label": "16:9 横屏"
     },
     {
      "value": "21:9",
      "label": "21:9 超宽屏"
     },
     {
      "value": "1:4",
      "label": "1:4 超竖版"
     },
     {
      "value": "4:1",
      "label": "4:1 超横版"
     },
     {
      "value": "1:8",
      "label": "1:8 极竖版"
     },
     {
      "value": "8:1",
      "label": "8:1 极横版"
     }
    ]
   },
   {
    "name": "imageSize",
    "label": "分辨率",
    "type": "select",
    "required": true,
    "options": [
     {
      "value": "0.5K",
      "label": "0.5K 极速"
     },
     {
      "value": "1K",
      "label": "1K 标清"
     },
     {
      "value": "2K",
      "label": "2K 高清"
     },
     {
      "value": "4K",
      "label": "4K 超清"
     }
    ]
   },
   {
    "name": "thinkingLevel",
    "label": "思考等级",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "minimal",
      "label": "快速"
     },
     {
      "value": "high",
      "label": "深度"
     }
    ]
   }
  ],
  "source": "platform-docs-2026-10-14"
 },
 {
  "name": "banana-pro-token",
  "display_name": "纳米香蕉 Pro Token版",
  "type": "image",
  "tags": [
   "文生图",
   "图生图",
   "4k",
   "高清",
   "香蕉",
   "官转直连"
  ],
  "api_format": "media",
  "params": [
   {
    "name": "images",
    "label": "参考图片",
    "type": "upload",
    "required": false,
    "max_count": 11
   },
   {
    "name": "aspectRatio",
    "label": "图片比例",
    "type": "select",
    "required": true,
    "options": [
     {
      "value": "1:1",
      "label": "1:1 正方形"
     },
     {
      "value": "2:3",
      "label": "2:3 竖版"
     },
     {
      "value": "3:2",
      "label": "3:2 横版"
     },
     {
      "value": "3:4",
      "label": "3:4 竖版"
     },
     {
      "value": "4:3",
      "label": "4:3 横版"
     },
     {
      "value": "4:5",
      "label": "4:5 竖版"
     },
     {
      "value": "5:4",
      "label": "5:4 横版"
     },
     {
      "value": "9:16",
      "label": "9:16 竖屏"
     },
     {
      "value": "16:9",
      "label": "16:9 横屏"
     },
     {
      "value": "21:9",
      "label": "21:9 超宽屏"
     }
    ]
   },
   {
    "name": "imageSize",
    "label": "分辨率",
    "type": "select",
    "required": true,
    "options": [
     {
      "value": "1K",
      "label": "1K 标清"
     },
     {
      "value": "2K",
      "label": "2K 高清"
     },
     {
      "value": "4K",
      "label": "4K 超清"
     }
    ]
   }
  ],
  "source": "platform-docs-2026-10-14"
 },
 {
  "name": "banana-pro",
  "display_name": "纳米香蕉 Pro",
  "type": "image",
  "tags": [
   "文生图",
   "图生图",
   "4k",
   "高清",
   "香蕉"
  ],
  "api_format": "media",
  "params": [
   {
    "name": "images",
    "label": "参考图片",
    "type": "upload",
    "required": false,
    "max_count": 14
   },
   {
    "name": "aspectRatio",
    "label": "图片比例",
    "type": "select",
    "required": true,
    "options": [
     {
      "value": "1:1",
      "label": "1:1 正方形"
     },
     {
      "value": "2:3",
      "label": "2:3 竖版"
     },
     {
      "value": "3:2",
      "label": "3:2 横版"
     },
     {
      "value": "3:4",
      "label": "3:4 竖版"
     },
     {
      "value": "4:3",
      "label": "4:3 横版"
     },
     {
      "value": "4:5",
      "label": "4:5 竖版"
     },
     {
      "value": "5:4",
      "label": "5:4 横版"
     },
     {
      "value": "9:16",
      "label": "9:16 竖屏"
     },
     {
      "value": "16:9",
      "label": "16:9 横屏"
     },
     {
      "value": "21:9",
      "label": "21:9 超宽屏"
     }
    ]
   },
   {
    "name": "imageSize",
    "label": "分辨率",
    "type": "select",
    "required": true,
    "options": [
     {
      "value": "1K",
      "label": "1K 标清"
     },
     {
      "value": "2K",
      "label": "2K 高清"
     },
     {
      "value": "4K",
      "label": "4K 超清"
     }
    ]
   }
  ],
  "source": "platform-docs-2026-10-14"
 },
 {
  "name": "doubao-seedream-4-5-251128",
  "display_name": "即梦 4.5",
  "type": "image",
  "tags": [
   "文生图",
   "图生图"
  ],
  "api_format": "media",
  "params": [
   {
    "name": "images",
    "label": "参考图片",
    "type": "upload",
    "required": false,
    "max_count": 10
   },
   {
    "name": "size",
    "label": "分辨率",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "2K",
      "label": "2K"
     },
     {
      "value": "4K",
      "label": "4K"
     }
    ]
   },
   {
    "name": "aspect_ratio",
    "label": "宽高比",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "1:1",
      "label": "1:1 正方形"
     },
     {
      "value": "4:3",
      "label": "4:3 横屏"
     },
     {
      "value": "3:4",
      "label": "3:4 竖屏"
     },
     {
      "value": "16:9",
      "label": "16:9 宽屏"
     },
     {
      "value": "9:16",
      "label": "9:16 手机竖屏"
     },
     {
      "value": "3:2",
      "label": "3:2 横屏"
     },
     {
      "value": "2:3",
      "label": "2:3 竖屏"
     },
     {
      "value": "21:9",
      "label": "21:9 超宽屏"
     }
    ]
   }
  ],
  "source": "platform-docs-2026-10-14"
 },
 {
  "name": "doubao-seedream-5-0-260128",
  "display_name": "即梦 5.0",
  "type": "image",
  "tags": [
   "文生图",
   "图生图",
   "多图融合",
   "联网搜索生图",
   "3k",
   "即梦"
  ],
  "api_format": "media",
  "params": [
   {
    "name": "images",
    "label": "参考图片",
    "type": "upload",
    "required": false,
    "max_count": 10
   },
   {
    "name": "size",
    "label": "分辨率",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "2K",
      "label": "2K"
     },
     {
      "value": "3K",
      "label": "3K"
     }
    ]
   },
   {
    "name": "aspect_ratio",
    "label": "宽高比",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "1:1",
      "label": "1:1 正方形"
     },
     {
      "value": "4:3",
      "label": "4:3 横屏"
     },
     {
      "value": "3:4",
      "label": "3:4 竖屏"
     },
     {
      "value": "16:9",
      "label": "16:9 宽屏"
     },
     {
      "value": "9:16",
      "label": "9:16 手机竖屏"
     },
     {
      "value": "3:2",
      "label": "3:2 横屏"
     },
     {
      "value": "2:3",
      "label": "2:3 竖屏"
     },
     {
      "value": "21:9",
      "label": "21:9 超宽屏"
     }
    ]
   }
  ],
  "source": "platform-docs-2026-10-14"
 },
 {
  "name": "doubao-seedream-5-0-pro-260628",
  "display_name": "即梦 5.0 Pro",
  "type": "image",
  "tags": [
   "文生图",
   "图生图",
   "多图融合",
   "2K高清",
   "即梦"
  ],
  "api_format": "media",
  "params": [
   {
    "name": "images",
    "label": "参考图片",
    "type": "upload",
    "required": false,
    "max_count": 10
   },
   {
    "name": "size",
    "label": "分辨率",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "2K",
      "label": "2K"
     },
     {
      "value": "1K",
      "label": "1K"
     }
    ]
   },
   {
    "name": "aspect_ratio",
    "label": "宽高比",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "1:1",
      "label": "1:1 正方形"
     },
     {
      "value": "4:3",
      "label": "4:3 横屏"
     },
     {
      "value": "3:4",
      "label": "3:4 竖屏"
     },
     {
      "value": "16:9",
      "label": "16:9 宽屏"
     },
     {
      "value": "9:16",
      "label": "9:16 手机竖屏"
     },
     {
      "value": "3:2",
      "label": "3:2 横屏"
     },
     {
      "value": "2:3",
      "label": "2:3 竖屏"
     },
     {
      "value": "21:9",
      "label": "21:9 超宽屏"
     }
    ]
   }
  ],
  "source": "platform-docs-2026-10-14"
 },
 {
  "name": "gk-image-2.0",
  "display_name": "GK Image 2.0",
  "type": "image",
  "tags": [
   "文生图",
   "图生图"
  ],
  "api_format": "media",
  "params": [
   {
    "name": "images",
    "label": "参考图片",
    "type": "upload",
    "required": false,
    "max_count": 3
   },
   {
    "name": "resolution",
    "label": "图片画质",
    "type": "select",
    "required": true,
    "options": [
     {
      "value": "1k",
      "label": "1K 标准"
     },
     {
      "value": "2k",
      "label": "2K 高清"
     }
    ]
   },
   {
    "name": "aspect_ratio",
    "label": "图片比例",
    "type": "select",
    "required": true,
    "options": [
     {
      "value": "1:1",
      "label": "1:1 正方形"
     },
     {
      "value": "16:9",
      "label": "16:9 宽屏"
     },
     {
      "value": "9:16",
      "label": "9:16 手机竖屏"
     },
     {
      "value": "4:3",
      "label": "4:3 横屏"
     },
     {
      "value": "3:4",
      "label": "3:4 竖屏"
     }
    ]
   }
  ],
  "source": "platform-docs-2026-10-14"
 },
 {
  "name": "kling-v3-omni",
  "display_name": "可灵-V3-Omni",
  "type": "image",
  "tags": [
   "文生图",
   "图生图",
   "多图融合",
   "4k",
   "高清"
  ],
  "api_format": "media",
  "params": [
   {
    "name": "images",
    "label": "参考图片",
    "type": "upload",
    "required": false,
    "max_count": 10
   },
   {
    "name": "resolution",
    "label": "分辨率",
    "type": "select",
    "required": true,
    "options": [
     {
      "value": "1k",
      "label": "1K 标清"
     },
     {
      "value": "2k",
      "label": "2K 高清"
     },
     {
      "value": "4k",
      "label": "4K 超高清"
     }
    ]
   },
   {
    "name": "aspect_ratio",
    "label": "图片比例",
    "type": "select",
    "required": true,
    "options": [
     {
      "value": "16:9",
      "label": "16:9 横屏"
     },
     {
      "value": "9:16",
      "label": "9:16 竖屏"
     },
     {
      "value": "1:1",
      "label": "1:1 正方形"
     },
     {
      "value": "4:3",
      "label": "4:3 横版"
     },
     {
      "value": "3:4",
      "label": "3:4 竖版"
     },
     {
      "value": "3:2",
      "label": "3:2 横版"
     },
     {
      "value": "2:3",
      "label": "2:3 竖版"
     },
     {
      "value": "21:9",
      "label": "21:9 超宽屏"
     }
    ]
   }
  ],
  "source": "platform-docs-2026-10-14"
 },
 {
  "name": "kling-v3",
  "display_name": "可灵-V3",
  "type": "image",
  "tags": [
   "文生图",
   "图生图",
   "高清"
  ],
  "api_format": "media",
  "params": [
   {
    "name": "images",
    "label": "参考图片",
    "type": "upload",
    "required": false,
    "max_count": 1
   },
   {
    "name": "resolution",
    "label": "分辨率",
    "type": "select",
    "required": true,
    "options": [
     {
      "value": "2k",
      "label": "2K 高清"
     },
     {
      "value": "1k",
      "label": "1K 标清"
     }
    ]
   },
   {
    "name": "aspect_ratio",
    "label": "图片比例",
    "type": "select",
    "required": true,
    "options": [
     {
      "value": "16:9",
      "label": "16:9 横屏"
     },
     {
      "value": "9:16",
      "label": "9:16 竖屏"
     },
     {
      "value": "1:1",
      "label": "1:1 正方形"
     },
     {
      "value": "4:3",
      "label": "4:3 横版"
     },
     {
      "value": "3:4",
      "label": "3:4 竖版"
     },
     {
      "value": "3:2",
      "label": "3:2 横版"
     },
     {
      "value": "2:3",
      "label": "2:3 竖版"
     },
     {
      "value": "21:9",
      "label": "21:9 超宽屏"
     }
    ]
   }
  ],
  "source": "platform-docs-2026-10-14"
 },
 {
  "name": "mj_imagine",
  "display_name": "Midjourney",
  "type": "image",
  "tags": [
   "文生图",
   "图生图"
  ],
  "api_format": "media",
  "params": [
   {
    "name": "images",
    "label": "参考图片",
    "type": "upload",
    "required": false,
    "max_count": 4
   },
   {
    "name": "botType",
    "label": "模型风格",
    "type": "select",
    "required": true,
    "options": [
     {
      "value": "MID_JOURNEY",
      "label": "MJ 写实模式"
     },
     {
      "value": "NIJI_JOURNEY",
      "label": "Niji 动漫模式"
     }
    ]
   },
   {
    "name": "aspectRatio",
    "label": "图片比例",
    "type": "select",
    "required": true,
    "options": [
     {
      "value": "1:1",
      "label": "1:1 正方形"
     },
     {
      "value": "16:9",
      "label": "16:9 横屏"
     },
     {
      "value": "9:16",
      "label": "9:16 竖屏"
     },
     {
      "value": "4:3",
      "label": "4:3 横版"
     },
     {
      "value": "3:4",
      "label": "3:4 竖版"
     },
     {
      "value": "3:2",
      "label": "3:2 横版"
     },
     {
      "value": "2:3",
      "label": "2:3 竖版"
     },
     {
      "value": "4:5",
      "label": "4:5 竖版"
     },
     {
      "value": "5:4",
      "label": "5:4 横版"
     },
     {
      "value": "21:9",
      "label": "21:9 超宽屏"
     }
    ]
   },
   {
    "name": "quality",
    "label": "质量",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "0.25",
      "label": "0.25 快速"
     },
     {
      "value": "0.5",
      "label": "0.5 标准"
     },
     {
      "value": "1",
      "label": "1 高清"
     },
     {
      "value": "2",
      "label": "2 超清"
     }
    ]
   },
   {
    "name": "stylize",
    "label": "风格化",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "0",
      "label": "0 写实"
     },
     {
      "value": "50",
      "label": "50 轻微"
     },
     {
      "value": "100",
      "label": "100 默认"
     },
     {
      "value": "250",
      "label": "250 中等"
     },
     {
      "value": "500",
      "label": "500 强烈"
     },
     {
      "value": "750",
      "label": "750 极强"
     },
     {
      "value": "1000",
      "label": "1000 极致"
     }
    ]
   },
   {
    "name": "chaos",
    "label": "混乱度",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "0",
      "label": "0 稳定"
     },
     {
      "value": "25",
      "label": "25 轻微变化"
     },
     {
      "value": "50",
      "label": "50 中等变化"
     },
     {
      "value": "75",
      "label": "75 大变化"
     },
     {
      "value": "100",
      "label": "100 最大变化"
     }
    ]
   },
   {
    "name": "style",
    "label": "风格",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "",
      "label": "默认"
     },
     {
      "value": "raw",
      "label": "Raw 原始"
     }
    ]
   }
  ],
  "source": "platform-docs-2026-10-14"
 },
 {
  "name": "qwen-image",
  "display_name": "千问-image-max",
  "type": "image",
  "tags": [
   "文生图",
   "图像编辑",
   "多图融合"
  ],
  "api_format": "media",
  "params": [
   {
    "name": "images",
    "label": "参考图片",
    "type": "upload",
    "required": false,
    "max_count": 3
   },
   {
    "name": "size",
    "label": "宽高比",
    "type": "select",
    "required": true,
    "options": [
     {
      "value": "1:1",
      "label": "正方形 1:1"
     },
     {
      "value": "2:3",
      "label": "竖版 2:3"
     },
     {
      "value": "3:2",
      "label": "横版 3:2"
     },
     {
      "value": "3:4",
      "label": "竖版 3:4"
     },
     {
      "value": "4:3",
      "label": "横版 4:3"
     },
     {
      "value": "9:16",
      "label": "竖版 9:16"
     },
     {
      "value": "16:9",
      "label": "横版 16:9"
     },
     {
      "value": "21:9",
      "label": "超宽 21:9"
     }
    ]
   },
   {
    "name": "prompt_extend",
    "label": "提示词优化",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "true",
      "label": "开启"
     },
     {
      "value": "false",
      "label": "关闭"
     }
    ]
   }
  ],
  "source": "platform-docs-2026-10-14"
 },
 {
  "name": "tt-image-2-token",
  "display_name": "TT Image 2 官转",
  "type": "image",
  "tags": [
   "文生图",
   "图生图"
  ],
  "api_format": "media",
  "params": [
   {
    "name": "images",
    "label": "参考图片",
    "type": "upload",
    "required": false,
    "max_count": 14
   },
   {
    "name": "size",
    "label": "图片比例",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "auto",
      "label": "自适应"
     },
     {
      "value": "1024x1024",
      "label": "正方形 (1:1)"
     },
     {
      "value": "1024x1536",
      "label": "竖版 (2:3)"
     },
     {
      "value": "1536x1024",
      "label": "横版 (3:2)"
     },
     {
      "value": "960x1280",
      "label": "竖版 (3:4)"
     },
     {
      "value": "1280x960",
      "label": "横版 (4:3)"
     },
     {
      "value": "1088x1920",
      "label": "竖版 (9:16)"
     },
     {
      "value": "1920x1088",
      "label": "横版 (16:9)"
     },
     {
      "value": "1024x1280",
      "label": "竖版 (4:5)"
     },
     {
      "value": "1280x1024",
      "label": "横版 (5:4)"
     },
     {
      "value": "960x1920",
      "label": "竖版 (1:2)"
     },
     {
      "value": "1920x960",
      "label": "横版 (2:1)"
     },
     {
      "value": "2048x2048",
      "label": "2K 正方形 (1:1)"
     },
     {
      "value": "2048x3072",
      "label": "2K 竖版 (2:3)"
     },
     {
      "value": "3072x2048",
      "label": "2K 横版 (3:2)"
     },
     {
      "value": "1920x2560",
      "label": "2K 竖版 (3:4)"
     },
     {
      "value": "2560x1920",
      "label": "2K 横版 (4:3)"
     },
     {
      "value": "1440x2560",
      "label": "2K 竖版 (9:16)"
     },
     {
      "value": "2560x1440",
      "label": "2K 横版 (16:9)"
     },
     {
      "value": "2048x2560",
      "label": "2K 竖版 (4:5)"
     },
     {
      "value": "2560x2048",
      "label": "2K 横版 (5:4)"
     },
     {
      "value": "1280x2560",
      "label": "2K 竖版 (1:2)"
     },
     {
      "value": "2560x1280",
      "label": "2K 横版 (2:1)"
     },
     {
      "value": "2880x2880",
      "label": "4K 正方形 (1:1)"
     },
     {
      "value": "2304x3456",
      "label": "4K 竖版 (2:3)"
     },
     {
      "value": "3456x2304",
      "label": "4K 横版 (3:2)"
     },
     {
      "value": "2400x3200",
      "label": "4K 竖版 (3:4)"
     },
     {
      "value": "3200x2400",
      "label": "4K 横版 (4:3)"
     },
     {
      "value": "2160x3840",
      "label": "4K 竖版 (9:16)"
     },
     {
      "value": "3840x2160",
      "label": "4K 横版 (16:9)"
     },
     {
      "value": "2560x3200",
      "label": "4K 竖版 (4:5)"
     },
     {
      "value": "3200x2560",
      "label": "4K 横版 (5:4)"
     },
     {
      "value": "1920x3840",
      "label": "4K 竖版 (1:2)"
     },
     {
      "value": "3840x1920",
      "label": "4K 横版 (2:1)"
     }
    ]
   },
   {
    "name": "quality",
    "label": "图片质量",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "auto",
      "label": "自适应"
     },
     {
      "value": "high",
      "label": "高"
     },
     {
      "value": "medium",
      "label": "中"
     },
     {
      "value": "low",
      "label": "低"
     }
    ]
   }
  ],
  "source": "platform-docs-2026-10-14"
 },
 {
  "name": "tt-image-2.5-token",
  "display_name": "TT Image 2.5 官转",
  "type": "image",
  "tags": [
   "文生图",
   "图生图",
   "透明背景"
  ],
  "api_format": "media",
  "params": [
   {
    "name": "images",
    "label": "参考图片",
    "type": "upload",
    "required": false,
    "max_count": 16
   },
   {
    "name": "version",
    "label": "模型版本",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "flare",
      "label": "标准版"
     },
     {
      "value": "sunburst",
      "label": "增强版"
     }
    ]
   },
   {
    "name": "aspect_ratio",
    "label": "图片比例",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "auto",
      "label": "自适应"
     },
     {
      "value": "1:1",
      "label": "1:1 正方形"
     },
     {
      "value": "16:9",
      "label": "16:9 横屏"
     },
     {
      "value": "9:16",
      "label": "9:16 竖屏"
     },
     {
      "value": "4:3",
      "label": "4:3 横版"
     },
     {
      "value": "3:4",
      "label": "3:4 竖版"
     },
     {
      "value": "3:2",
      "label": "3:2 横版"
     },
     {
      "value": "2:3",
      "label": "2:3 竖版"
     },
     {
      "value": "5:4",
      "label": "5:4 横版"
     },
     {
      "value": "4:5",
      "label": "4:5 竖版"
     },
     {
      "value": "2:1",
      "label": "2:1 超宽横版"
     },
     {
      "value": "1:2",
      "label": "1:2 超长竖版"
     },
     {
      "value": "21:9",
      "label": "21:9 影院宽幅"
     },
     {
      "value": "9:21",
      "label": "9:21 超长竖幅"
     }
    ]
   },
   {
    "name": "resolution",
    "label": "分辨率",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "auto",
      "label": "自适应"
     },
     {
      "value": "1K",
      "label": "1K"
     },
     {
      "value": "2K",
      "label": "2K"
     },
     {
      "value": "4K",
      "label": "4K"
     }
    ]
   },
   {
    "name": "quality",
    "label": "画质",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "auto",
      "label": "自适应"
     },
     {
      "value": "low",
      "label": "低"
     },
     {
      "value": "medium",
      "label": "中"
     },
     {
      "value": "high",
      "label": "高"
     },
     {
      "value": "xhigh",
      "label": "超高"
     },
     {
      "value": "max",
      "label": "极致"
     }
    ]
   },
   {
    "name": "background",
    "label": "透明背景",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "opaque",
      "label": "不要透明背景"
     },
     {
      "value": "transparent",
      "label": "要透明背景"
     },
     {
      "value": "auto",
      "label": "自适应"
     }
    ]
   },
   {
    "name": "size",
    "label": "自定义尺寸",
    "type": "string",
    "required": false
   }
  ],
  "source": "platform-docs-2026-10-14"
 },
 {
  "name": "tt-image-2.5",
  "display_name": "TT Image 2.5",
  "type": "image",
  "tags": [
   "文生图",
   "图生图",
   "透明背景"
  ],
  "api_format": "media",
  "params": [
   {
    "name": "images",
    "label": "参考图片",
    "type": "upload",
    "required": false,
    "max_count": 16
   },
   {
    "name": "version",
    "label": "模型版本",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "flare",
      "label": "标准版"
     },
     {
      "value": "sunburst",
      "label": "增强版"
     }
    ]
   },
   {
    "name": "aspect_ratio",
    "label": "图片比例",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "auto",
      "label": "自适应"
     },
     {
      "value": "1:1",
      "label": "1:1 正方形"
     },
     {
      "value": "16:9",
      "label": "16:9 横屏"
     },
     {
      "value": "9:16",
      "label": "9:16 竖屏"
     },
     {
      "value": "4:3",
      "label": "4:3 横版"
     },
     {
      "value": "3:4",
      "label": "3:4 竖版"
     },
     {
      "value": "3:2",
      "label": "3:2 横版"
     },
     {
      "value": "2:3",
      "label": "2:3 竖版"
     },
     {
      "value": "5:4",
      "label": "5:4 横版"
     },
     {
      "value": "4:5",
      "label": "4:5 竖版"
     },
     {
      "value": "2:1",
      "label": "2:1 超宽横版"
     },
     {
      "value": "1:2",
      "label": "1:2 超长竖版"
     },
     {
      "value": "21:9",
      "label": "21:9 影院宽幅"
     },
     {
      "value": "9:21",
      "label": "9:21 超长竖幅"
     }
    ]
   },
   {
    "name": "resolution",
    "label": "分辨率",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "auto",
      "label": "自适应"
     },
     {
      "value": "1K",
      "label": "1K"
     },
     {
      "value": "2K",
      "label": "2K"
     },
     {
      "value": "4K",
      "label": "4K"
     }
    ]
   },
   {
    "name": "quality",
    "label": "画质",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "auto",
      "label": "自适应"
     },
     {
      "value": "low",
      "label": "低"
     },
     {
      "value": "medium",
      "label": "中"
     },
     {
      "value": "high",
      "label": "高"
     },
     {
      "value": "xhigh",
      "label": "超高"
     },
     {
      "value": "max",
      "label": "极致"
     }
    ]
   },
   {
    "name": "background",
    "label": "透明背景",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "opaque",
      "label": "不要透明背景"
     },
     {
      "value": "transparent",
      "label": "要透明背景"
     },
     {
      "value": "auto",
      "label": "自适应"
     }
    ]
   },
   {
    "name": "size",
    "label": "自定义尺寸",
    "type": "string",
    "required": false
   }
  ],
  "source": "platform-docs-2026-10-14"
 },
 {
  "name": "tt-image-2",
  "display_name": "TT Image 2",
  "type": "image",
  "tags": [
   "文生图",
   "图生图"
  ],
  "api_format": "media",
  "params": [
   {
    "name": "images",
    "label": "参考图片",
    "type": "upload",
    "required": false,
    "max_count": 14
   },
   {
    "name": "size",
    "label": "图片比例",
    "type": "select",
    "required": true,
    "options": [
     {
      "value": "auto",
      "label": "自适应"
     },
     {
      "value": "1024x1024",
      "label": "正方形 (1:1)"
     },
     {
      "value": "1024x1536",
      "label": "竖版 (2:3)"
     },
     {
      "value": "1536x1024",
      "label": "横版 (3:2)"
     },
     {
      "value": "960x1280",
      "label": "竖版 (3:4)"
     },
     {
      "value": "1280x960",
      "label": "横版 (4:3)"
     },
     {
      "value": "1088x1920",
      "label": "竖版 (9:16)"
     },
     {
      "value": "1920x1088",
      "label": "横版 (16:9)"
     },
     {
      "value": "1024x1280",
      "label": "竖版 (4:5)"
     },
     {
      "value": "1280x1024",
      "label": "横版 (5:4)"
     },
     {
      "value": "960x1920",
      "label": "竖版 (1:2)"
     },
     {
      "value": "1920x960",
      "label": "横版 (2:1)"
     },
     {
      "value": "2048x2048",
      "label": "2K 正方形 (1:1)"
     },
     {
      "value": "2048x3072",
      "label": "2K 竖版 (2:3)"
     },
     {
      "value": "3072x2048",
      "label": "2K 横版 (3:2)"
     },
     {
      "value": "1920x2560",
      "label": "2K 竖版 (3:4)"
     },
     {
      "value": "2560x1920",
      "label": "2K 横版 (4:3)"
     },
     {
      "value": "1440x2560",
      "label": "2K 竖版 (9:16)"
     },
     {
      "value": "2560x1440",
      "label": "2K 横版 (16:9)"
     },
     {
      "value": "2048x2560",
      "label": "2K 竖版 (4:5)"
     },
     {
      "value": "2560x2048",
      "label": "2K 横版 (5:4)"
     },
     {
      "value": "1280x2560",
      "label": "2K 竖版 (1:2)"
     },
     {
      "value": "2560x1280",
      "label": "2K 横版 (2:1)"
     },
     {
      "value": "2880x2880",
      "label": "4K 正方形 (1:1)"
     },
     {
      "value": "2304x3456",
      "label": "4K 竖版 (2:3)"
     },
     {
      "value": "3456x2304",
      "label": "4K 横版 (3:2)"
     },
     {
      "value": "2400x3200",
      "label": "4K 竖版 (3:4)"
     },
     {
      "value": "3200x2400",
      "label": "4K 横版 (4:3)"
     },
     {
      "value": "2160x3840",
      "label": "4K 竖版 (9:16)"
     },
     {
      "value": "3840x2160",
      "label": "4K 横版 (16:9)"
     },
     {
      "value": "2560x3200",
      "label": "4K 竖版 (4:5)"
     },
     {
      "value": "3200x2560",
      "label": "4K 横版 (5:4)"
     },
     {
      "value": "1920x3840",
      "label": "4K 竖版 (1:2)"
     },
     {
      "value": "3840x1920",
      "label": "4K 横版 (2:1)"
     }
    ]
   },
   {
    "name": "quality",
    "label": "图片质量",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "auto",
      "label": "自适应"
     },
     {
      "value": "high",
      "label": "高"
     },
     {
      "value": "medium",
      "label": "中"
     },
     {
      "value": "low",
      "label": "低"
     }
    ]
   }
  ],
  "source": "platform-docs-2026-10-14"
 },
 {
  "name": "vidu-image-2",
  "display_name": "VIDU Iamge 2",
  "type": "image",
  "tags": [
   "文生图",
   "多图参考",
   "图片编辑",
   "1K/2K/3K",
   "Vidu官方"
  ],
  "api_format": "media",
  "params": [
   {
    "name": "images",
    "label": "参考图片",
    "type": "upload",
    "required": false,
    "max_count": 14
   },
   {
    "name": "aspect_ratio",
    "label": "画幅比例",
    "type": "select",
    "required": true,
    "options": [
     {
      "value": "16:9",
      "label": "16:9"
     },
     {
      "value": "9:16",
      "label": "9:16"
     },
     {
      "value": "1:1",
      "label": "1:1"
     },
     {
      "value": "4:3",
      "label": "4:3"
     },
     {
      "value": "3:4",
      "label": "3:4"
     },
     {
      "value": "3:2",
      "label": "3:2"
     },
     {
      "value": "2:3",
      "label": "2:3"
     },
     {
      "value": "5:4",
      "label": "5:4"
     },
     {
      "value": "4:5",
      "label": "4:5"
     },
     {
      "value": "7:3",
      "label": "7:3"
     }
    ]
   },
   {
    "name": "resolution",
    "label": "分辨率",
    "type": "select",
    "required": true,
    "options": [
     {
      "value": "1K",
      "label": "1K"
     },
     {
      "value": "2K",
      "label": "2K"
     },
     {
      "value": "3K",
      "label": "3K"
     }
    ]
   },
   {
    "name": "quality",
    "label": "质量",
    "type": "select",
    "required": true,
    "options": [
     {
      "value": "low",
      "label": "低"
     },
     {
      "value": "medium",
      "label": "中"
     },
     {
      "value": "high",
      "label": "高"
     }
    ]
   },
   {
    "name": "style",
    "label": "风格",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "general",
      "label": "通用"
     }
    ]
   }
  ],
  "source": "platform-docs-2026-10-14"
 },
 {
  "name": "wan2.6-image",
  "display_name": "万相 2.6 图像",
  "type": "image",
  "tags": [
   "文生图",
   "图生图"
  ],
  "api_format": "media",
  "params": [
   {
    "name": "images",
    "label": "参考图片",
    "type": "upload",
    "required": false,
    "max_count": 4
   },
   {
    "name": "size",
    "label": "宽高比",
    "type": "select",
    "required": true,
    "options": [
     {
      "value": "1:1",
      "label": "正方形 1:1"
     },
     {
      "value": "2:3",
      "label": "竖版 2:3"
     },
     {
      "value": "3:2",
      "label": "横版 3:2"
     },
     {
      "value": "3:4",
      "label": "竖版 3:4"
     },
     {
      "value": "4:3",
      "label": "横版 4:3"
     },
     {
      "value": "9:16",
      "label": "竖版 9:16"
     },
     {
      "value": "16:9",
      "label": "横版 16:9"
     },
     {
      "value": "21:9",
      "label": "超宽 21:9"
     }
    ]
   },
   {
    "name": "prompt_extend",
    "label": "提示词优化",
    "type": "select",
    "required": false,
    "options": [
     {
      "value": "true",
      "label": "开启"
     },
     {
      "value": "false",
      "label": "关闭"
     }
    ]
   }
  ],
  "source": "platform-docs-2026-10-14"
 },
 {
  "name": "wan2.7-image",
  "display_name": "万相 2.7 图像",
  "type": "image",
  "tags": [
   "文生图",
   "图生图"
  ],
  "api_format": "media",
  "params": [
   {
    "name": "images",
    "label": "参考图片",
    "type": "upload",
    "required": false,
    "max_count": 9
   },
   {
    "name": "quality",
    "label": "质量模式",
    "type": "select",
    "required": true,
    "options": [
     {
      "value": "standard",
      "label": "标准"
     },
     {
      "value": "pro",
      "label": "高质量"
     }
    ]
   },
   {
    "name": "size",
    "label": "宽高比",
    "type": "select",
    "required": true,
    "options": [
     {
      "value": "1:1",
      "label": "正方形 1:1"
     },
     {
      "value": "3:4",
      "label": "竖版 3:4"
     },
     {
      "value": "4:3",
      "label": "横版 4:3"
     },
     {
      "value": "9:16",
      "label": "竖版 9:16"
     },
     {
      "value": "16:9",
      "label": "横版 16:9"
     },
     {
      "value": "2:3",
      "label": "竖版 2:3"
     },
     {
      "value": "3:2",
      "label": "横版 3:2"
     }
    ]
   }
  ],
  "source": "platform-docs-2026-10-14"
 }
]
;
