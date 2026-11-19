---
slug: pruna-qwen-image-2-1-remove-object-lora
title: "Pruna Qwen Image 2.1 Remove Object LoRA: What It Is and How to Use It"
seoTitle: Pruna Qwen Image 2.1 Remove Object LoRA Guide
description: Understand Pruna’s Qwen Image 2.1 object-removal adapters, choose a
  compatible ComfyUI workflow, and inspect results and license conditions.
publishedAt: 2026-11-19
updatedAt: 2026-11-19
readTime: 9 min read
author: WatermarkGemini Editorial Team
category: Guide
featured: false
draft: false
contentMode: markdown
bodyHtml: <p></p>
---
Pruna’s P-Q-Image-2.1-Remove-Object is a set of adapters for object removal with Qwen-Image-2.1. The ComfyUI export supplies ready-made workflows, example material and a custom node. It is not a complete standalone image editor: you still need the compatible base model, supporting components and the correct adapter combination.

The practical choice is between using that configurable local workflow and using a simpler browser editor for a single image. This guide explains the published Pruna setup, the decisions that matter and how to evaluate the result. The Pruna workflow was reviewed from its author documentation; it was not installed or benchmarked for this article.

## What the remove-object LoRA changes

A LoRA is an adapter used with a compatible model. In this case, the adapter specializes the image-editing process toward removing a specified object. The removal instruction and optional mask tell the workflow what should change, while the rest of the image provides context.

This is a generation task. If a person covers a sign, removing the person does not reveal a stored photograph of the sign behind them. The model constructs a plausible replacement. That distinction matters for product lettering, architectural details and any image used as evidence.

Pruna’s ComfyUI package also handles the input and comparison workflow. An optional painted or loaded mask helps identify the region, and the supplied instruction node prepares the selection in the form expected by the model. Use that supplied workflow as your starting point rather than building a random collection of similarly named nodes.

The author's example shows an object-removal result, not a universal quality guarantee. A published before-and-after comparison can help you understand the intended task, but it does not establish how the workflow performs on your GPU or a different image.

![Pruna author comparison showing a phone and raised arm removed from a concert photo](/uploads/blog-20261114/pruna-qwen-image-2-1-remove-object-lora/figure-1.jpg)

*Published Pruna example, not our benchmark. Original photo by Aliaksei Antropau on Unsplash; edited example supplied by Pruna. [Image source](https://huggingface.co/PrunaAI/P-Q-Image-2.1-Remove-Object-Comfy)*

## Choose a compatible variant

The author supplies few-step variants and a base variant. Their settings are not interchangeable. The few-step routes need the matching distillation adapter as well as the removal adapter; the base route follows a different configuration.

| **Published variant** | **Steps** | **Removal strength** | **Distillation adapter** |
| --- | --- | --- | --- |
| 6-step | 6 | 0.7 | Matching 6-step adapter at 1.0 |
| 8-step | 8 | 0.7 | Matching 8-step adapter at 1.0 |
| Base | 40 | 1.0 | None |

Start with the author-recommended six-step workflow when evaluating the few-step route. Keep the supplied schedule and other internal settings together. Raising or lowering the step count alone does not turn one adapter into another version.

A practical evaluation changes one variable at a time. Save the original workflow, duplicate it for experiments and record the variant, seed and strength with each output. Otherwise, a better-looking result may be impossible to reproduce because you changed several settings at once.

“Six steps” is not a measured time promise. Runtime and memory use depend on the hardware, model files and software environment. This article does not claim a minimum VRAM figure or a particular speedup because no local benchmark was performed.

## Prepare ComfyUI and the model files

Use a ComfyUI version with native support for Qwen-Image-2.1. Follow the model links inside the supplied workflow and the linked Comfy-Org and Pruna repositories. Check exact filenames and model families before downloading large files.

The setup includes a diffusion model, text encoders, a VAE and the relevant LoRAs. The author’s example places these in the corresponding diffusion\_models, text\_encoders, vae and loras folders under ComfyUI/models. A file in the wrong folder may not appear in its loader even when the download succeeded.

Do not substitute Qwen-Image weights from another release merely because the name looks similar. An adapter expects a compatible base architecture. Keep the selected workflow, model components and adapter versions together as a reproducible set.

The package also includes the precise\_removal\_outline custom node. Follow its repository instructions for installation into ComfyUI’s own environment, including the stated dependency, then restart the application. Installing a dependency into an unrelated Python environment will not necessarily make it available to ComfyUI.

Before running a job, inspect every loader in the graph. Confirm that the selected file exists and is complete. If a download was interrupted, fix that issue first rather than troubleshooting the model prompt. Keep a small record of component versions so that a future update does not silently change your results.

## Load the supplied workflow and your own image

Drag the appropriate supplied workflow JSON into ComfyUI. The six-step file is named p\_q\_image\_2.1\_remove\_object\_v0.1\_6step.json in the author’s workflows folder. Inspect the model links note and resolve any missing components before pressing Run.

Replace the example with a photo you have permission to edit. Choose an initial task whose result you can evaluate: an isolated object on a textured table is easier to assess than a person covering half a face. Keep the source image unchanged and save outputs separately.

Write a concrete instruction naming the target. If there are several similar objects, identify position or another visible feature. “Remove the bottle on the left” is easier to inspect than an instruction that combines removal with a new lighting style, a different background and unrelated changes.

For your first comparison, keep the scene and desired output simple. Do not introduce a client’s critical product photo as the first diagnostic input. Establish that the graph loads and produces an output before judging fine-detail preservation on a demanding image.

## Use an optional mask carefully

The supplied workflow allows a mask painted through the image loader’s MaskEditor or a separately loaded mask file. In the documented file-mask route, white identifies the edit region and black identifies what should remain. Check the mask’s alignment with the actual photo rather than relying on its filename.

Include the complete target and any shadow or reflection you intend to remove. Where another object overlaps the target, keep the selection away from content that must remain. A generous mask can help cover the distraction, but unnecessary overlap asks the model to reconstruct more of the scene.

The author’s instruction node prepares an outline for the model when a mask is present. Do not add a decorative red outline directly to your only original photo as a substitute. Work through the supplied graph so that the input preparation matches the expected workflow.

An optional mask is not a promise that an instruction alone will always pick the correct object. If an unmasked result removes the wrong item, return to a clearer instruction and explicit selection. Save the mask with your experiment so another editor can understand what you intended to change.

## Run and inspect the result

Check the graph for missing models or node errors, then run the workflow. Keep the source, output and workflow together. Use the supplied comparison view where available, or open the source and result in a separate image viewer if your interface does not expose the expected slider.

Review the complete image, not just the repaired spot. Inspect neighboring hands, faces, lettering, repeated patterns and straight edges. A successful disappearance can still be an unsuitable edit if the model changes a meaningful part of the surrounding scene.

Check resolution and crop as well. Matching dimensions do not prove identical content outside the selection. For a production asset, compare important regions at a useful zoom and inspect the final exported file rather than only the node preview.

If you change a seed, strength or mask, save a new output and note the change. Keep the best previous result available so you can judge whether another generation improved the image or merely produced a different set of errors.

## Troubleshoot by the type of failure

### The workflow cannot load

Check software support, missing custom nodes and loader paths before changing generation settings. A missing model is an installation issue. A graph that runs but produces a poor fill is a different problem and needs a different diagnostic approach.

### The wrong object disappears

Compare the instruction with the visible input. Add a positional description and inspect the mask alignment. Make one controlled adjustment, save the new output and compare it with the prior attempt. Do not increase every setting at once.

### The repaired texture looks smooth or patterned

Examine the boundary and the surrounding texture. If the patch damages the image, try a revised selection or another seed and retain the source. For material that needs exact detail, use a clean original or manual editing rather than treating a plausible fill as recovery.

### Nearby content changes

Reduce unwanted overlap in the mask and simplify the instruction. Inspect any person or object that touches the target. If the required subject cannot be preserved reliably, stop using that generated result for the task instead of hiding the damage in a smaller preview.

## A browser option for a simple object cleanup

If installing a model stack is disproportionate to the task, WatermarkGemini’s Object Remover offers a browser route for an authorized still image. It is a separate service, not a hosted version of the Pruna adapter, and its output should not be used as a Pruna performance benchmark.

Two practical scenarios are removing a distracting cup from a desk photo and clearing an obsolete label from an approved campaign image. In either case, the goal is local visual cleanup, not recovery of hidden facts or removal of AI provenance.

- **Region selection:** Brush and Lasso define the visible distraction to be replaced.
- **Mask refinement:** Eraser, Undo and Clear help keep the selection off important neighboring content.
- **Generated reconstruction:** The service fills the selected region from image context; the replacement requires visual review.
- **Comparison views:** Original, Result and Compare support checking the edit before saving it.

1.  Keep the source and open WatermarkGemini’s Object Remover. Upload a supported image you are allowed to edit.
2.  Confirm Remove object, then use Brush or Lasso to cover the complete distraction. Include a shadow only if it should disappear.
3.  Refine the mask with Eraser or Undo, keeping it off important neighboring content. Inspect the actual processing quote before starting.

![WatermarkGemini diagnostic mask and a quote of one free image use](/uploads/blog-20261114/pruna-qwen-image-2-1-remove-object-lora/figure-2.jpg)

*Actual one-free-use quote from our diagnostic test. The diagonal mask spill on the laptop should be undone before a production edit; this test was not a flawless selection. Photo: Nenad Stojković / Shixart1985, CC BY 2.0; resized and edited. [Image source](https://www.watermarkgemini.com/remove-object) [Photo and license](https://commons.wikimedia.org/wiki/File:Coffee_cup_next_to_laptop_on_wooden_table_in_cozy_indoor_workspace_during_daytime.jpg)*

1.  Wait for completion and use Original, Result and Compare to check the repair. Return to the source if important detail changes.
2.  Download the PNG before the temporary result expires. Open the saved file and inspect the repaired region, edges and text at full size.

Our one free test removed a cup from a licensed desk photograph and produced a 1920 × 1282 PNG. The diagnostic mask included overspill onto the laptop, and full-size inspection showed small bright residuals. The output still needs quality review. That result does not predict performance on overlapping faces, tiny text or complex reflections. Retain a clean original when those details matter.

![WatermarkGemini completed cup removal with Download PNG available](/uploads/blog-20261114/pruna-qwen-image-2-1-remove-object-lora/figure-3.jpg)

*WatermarkGemini completed cup removal with Download PNG available. Test photo: Nenad Stojković / Shixart1985, CC BY 2.0; resized source and edited result. One free test, November 14, 2026. [Image source](https://www.watermarkgemini.com/remove-object) [Photo and license](https://commons.wikimedia.org/wiki/File:Coffee_cup_next_to_laptop_on_wooden_table_in_cozy_indoor_workspace_during_daytime.jpg)*

## Frequently asked questions

### Is the Pruna remove-object LoRA a standalone app?

No. It is an adapter workflow that depends on compatible model components and software. Follow the supplied ComfyUI setup rather than loading one file into an unrelated editor.

### Can I mix the six-step and eight-step adapters?

Use the matching combination documented by the author. The workflow’s adapter, schedule and step count are intended to work together.

### Does a mask guarantee the rest of the image is unchanged?

Do not treat that as a universal guarantee. Review important surrounding content and the final output, especially at overlaps and in fine texture.

### Is the model automatically cleared for commercial use?

No. The repository points to the Qwen research license and additional dependency terms. Review the applicable licenses before use or redistribution.

## Sources

- [Pruna AI — P-Q-Image-2.1-Remove-Object-Comfy Model Card](https://huggingface.co/PrunaAI/P-Q-Image-2.1-Remove-Object-Comfy)
- [Comfy Org — Qwen-Image-2.1 Model Components](https://huggingface.co/Comfy-Org/Qwen-Image-2.1)
- [Pruna AI — P-Q-Image-2.1-Comfy Distillation Adapters](https://huggingface.co/PrunaAI/P-Q-Image-2.1-Comfy)
- [Qwen — Qwen-Image-2.1 License](https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/LICENSE)
- [WatermarkGemini — AI Object Remover](https://www.watermarkgemini.com/remove-object)
