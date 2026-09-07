# Local vision model inventory

| File | Purpose | Source | License | SHA-256 |
| --- | --- | --- | --- | --- |
| `face_detection_yunet_2023mar_int8.onnx` | Local face-detection redaction | [OpenCV Zoo YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) | Apache-2.0 | `321aa5a6afabf7ecc46a3d06bfab2b579dc96eb5c3be7edd365fa04502ad9294` |

The model is bundled with the extension and is never fetched from a user page or
a reasoning provider. It is the OpenCV Zoo INT8 YuNet variant. The detector is
not face recognition: its only purpose in Nudge is finding visible face regions
to redact before a screenshot can leave the browser.
