# Local vision model inventory

| File | Purpose | Source | License | SHA-256 |
| --- | --- | --- | --- | --- |
| `face_detection_yunet_2023mar_int8.onnx` | Local face-detection redaction | [OpenCV Zoo YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) | Apache-2.0 | `321aa5a6afabf7ecc46a3d06bfab2b579dc96eb5c3be7edd365fa04502ad9294` |
| `ch_PP-OCRv4_det.onnx` | Local screenshot text-region detection | [PP-OCRv4 ONNX export](https://huggingface.co/webnn/PP-OCRv4-ONNX) | Apache-2.0 | `30a86f5731181461d08021402766601e4302a9b9b9666be8aff402696339cdff` |
| `ch_PP-OCRv4_rec.onnx` | Local text recognition for detected regions | [PP-OCRv4 ONNX export](https://huggingface.co/webnn/PP-OCRv4-ONNX) | Apache-2.0 | `06b3e6af6c59a1ba5d53790ed8c2e4b2de389870b6cf5a97f349f3412cb269c0` |
| `ch_PP-OCR_keys_v1.txt` | PP-OCRv4 recognition vocabulary | [PP-OCRv4 ONNX export](https://huggingface.co/webnn/PP-OCRv4-ONNX) | Apache-2.0 | `28b2362ad4ab2dc38769aa72feb535e3a9ddb3fd2a7585a05920e6393b1dc7f7` |

The model is bundled with the extension and is never fetched from a user page or
a reasoning provider. It is the OpenCV Zoo INT8 YuNet variant. The detector is
not face recognition: its only purpose in Nudge is finding visible face regions
to redact before a screenshot can leave the browser.

The PP-OCR detector and recognizer are also bundled; their boxes and recognized
text are used only inside Nudge's offscreen vision document to identify visual
PII before the redaction renderer runs.
