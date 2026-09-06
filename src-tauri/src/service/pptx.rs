//! PPT 生成（直接手写 OOXML）。
//!
//! 流程：用 ffmpeg 把每句/全文音频“预烘焙”成成品片段，然后用 `zip` 直接组装
//! 一个合法的 .pptx：宽画幅(16:9)、每个音频作为真正的 `ppt/media/*.wav` 媒体部件
//! 并由对应幻灯片的 relationship 引用（PowerPoint 内可直接点击播放）。
//!
//! 幻灯片结构：
//! 1. 全文听写（整段音频，自动播放）
//! 2. 每个句子 j 两页：
//!    - “句子 j · 听写”：只有音频播放按钮（无文本）
//!    - “句子 j · 答案”：同音频 + 句子文本
//! 3. 全文听读（按句分页，每页文本 + 音频）

use std::{
    io::{Cursor, Write},
    path::{Path, PathBuf},
    process::Command,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use zip::{write::SimpleFileOptions, ZipWriter};

use crate::{
    error::{Error, Result},
    service::audio::{sanitize_filename, unique_path},
};

const SAMPLE_RATE: u32 = 16000;
/// 宽画幅 16:9 (EMU)。
const SLIDE_W: i64 = 12_192_000;
const SLIDE_H: i64 = 6_858_000;
/// 页边距（约 0.7 英寸），标题/正文不贴边。
const MARGIN: i64 = 800_000;

const NS_A: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_P: &str = "http://schemas.openxmlformats.org/presentationml/2006/main";

/// 幻灯片“播放”按钮用的图标（嵌入 PPT，跨幻灯片复用）。
const PLAY_PNG: &[u8] = include_bytes!("../../assets/play_button.png");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PptSentence {
    pub start: f32,
    pub end: f32,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PptOptions {
    pub project_name: String,
    /// 每句听几遍。
    pub listen_times: u32,
    /// 每遍倍速（与 listen_times 等长）。
    pub speeds: Vec<f32>,
    /// 每遍之间的间隔（秒）。
    pub gap_seconds: f32,
    /// 全文听写/听读的倍速。
    pub full_text_speed: f32,
}

/// 一条“成品音频”：文件名（存到 ppt/media/）+ 实际字节。
struct MediaClip {
    ext: String,
    bytes: Vec<u8>,
}

/// 组装好的一个幻灯片（OOXML 由 build 阶段生成）。
struct SlideSpec {
    /// 标题（显示在顶部）。
    title: String,
    /// 正文文本（可为空 = 只有播放按钮的“听写”页）。
    body: Vec<String>,
    /// 本页引用的媒体（在 slide 的 rels 中占一个 rId）。
    media: Option<usize>,
}

/// 在内存里构造的 OOXML 包。
struct Ooxml {
    entries: Vec<(String, Vec<u8>)>,
}

impl Ooxml {
    fn new() -> Self {
        Ooxml {
            entries: Vec::new(),
        }
    }
    fn add(&mut self, name: &str, data: Vec<u8>) {
        self.entries.push((name.to_string(), data));
    }
    fn add_str(&mut self, name: &str, data: &str) {
        self.add(name, data.as_bytes().to_vec());
    }
    /// 写出成 zip（.pptx）字节。
    fn build(mut self) -> Result<Vec<u8>> {
        // 确保 [Content_Types].xml 在首位（部分严格 reader 期望）。
        self.entries.sort_by(|a, b| {
            let ka = if a.0 == "[Content_Types].xml" { 0 } else { 1 };
            let kb = if b.0 == "[Content_Types].xml" { 0 } else { 1 };
            ka.cmp(&kb).then_with(|| a.0.cmp(&b.0))
        });
        let mut out = Cursor::new(Vec::new());
        let mut zw = ZipWriter::new(&mut out);
        for (name, data) in &self.entries {
            let name = name.clone();
            zw.start_file(
                name.clone(),
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated),
            )
            .map_err(|e| Error::Other(format!("写 zip 条目 {name}: {e}")))?;
            zw.write_all(data)
                .map_err(|e| Error::Other(format!("写 zip 条目 {name}: {e}")))?;
        }
        zw.finish().map_err(|e| Error::Other(e.to_string()))?;
        Ok(out.into_inner())
    }
}

/// 生成 PPT 到系统下载目录，返回输出路径。
#[tauri::command]
pub async fn generate_pptx(
    app: AppHandle,
    audio_path: String,
    sentences: Vec<PptSentence>,
    options: PptOptions,
) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || {
        generate_pptx_inner(&app, &audio_path, &sentences, &options)
    })
    .await
    .map_err(|e| Error::Other(e.to_string()))?
}

fn generate_pptx_inner(
    app: &AppHandle,
    audio_path: &str,
    sentences: &[PptSentence],
    options: &PptOptions,
) -> Result<String> {
    let work_root = app
        .path()
        .app_data_dir()
        .map_err(|e| Error::Other(e.to_string()))?
        .join("ppt_work");
    std::fs::create_dir_all(&work_root)?;
    let work = work_root.join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&work)?;

    let result = build_pptx_bytes(audio_path, sentences, options, &work).and_then(|bytes| {
        let downloads = app
            .path()
            .download_dir()
            .map_err(|e| Error::Other(e.to_string()))?;
        std::fs::create_dir_all(&downloads)?;
        let out = unique_path(
            downloads.join(format!("{}.pptx", sanitize_filename(&options.project_name))),
        );
        std::fs::write(&out, &bytes)?;
        Ok(out.to_string_lossy().into_owned())
    });

    let _ = std::fs::remove_dir_all(&work);
    result
}

/// 纯函数：给定已处理音频路径与句子，产出 .pptx 字节（便于测试）。
pub fn build_pptx_bytes(
    audio_path: &str,
    sentences: &[PptSentence],
    options: &PptOptions,
    work: &Path,
) -> Result<Vec<u8>> {
    // 1) 烘焙音频 → 收集 media clip（文件名自增）。
    let mut media: Vec<MediaClip> = Vec::new();
    let mut by_path: std::collections::HashMap<PathBuf, usize> = std::collections::HashMap::new();

    let add_media = |p: &Path,
                     media: &mut Vec<MediaClip>,
                     by: &mut std::collections::HashMap<PathBuf, usize>,
                     idx: &mut usize|
     -> Result<usize> {
        if let Some(&i) = by.get(p) {
            return Ok(i);
        }
        let bytes = std::fs::read(p)?;
        let ext = p
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("wav")
            .to_string();
        *idx += 1;
        let id = *idx - 1;
        media.push(MediaClip { ext, bytes });
        by.insert(p.to_path_buf(), id);
        Ok(id)
    };

    // 全文音频（独立，不合并）
    let full_path = bake_full(audio_path, options.full_text_speed, work)?;
    let mut media_index = 0usize;
    let full_media = add_media(&full_path, &mut media, &mut by_path, &mut media_index)?;

    // 每句一段成品音频
    let mut sent_media: Vec<usize> = Vec::with_capacity(sentences.len());
    for (i, s) in sentences.iter().enumerate() {
        let clip = bake_sentence(audio_path, s, options, work, i)?;
        sent_media.push(add_media(
            &clip,
            &mut media,
            &mut by_path,
            &mut media_index,
        )?);
    }

    // 全文听读分页音频
    let pages = paginate(sentences);
    let mut read_media: Vec<usize> = Vec::with_capacity(pages.len());
    for (i, page) in pages.iter().enumerate() {
        let first = *page.first().unwrap_or(&0);
        let last = *page.last().unwrap_or(&first);
        let clip = bake_clip(
            audio_path,
            sentences[first].start,
            sentences[last].end,
            options.full_text_speed,
            work,
            &format!("read{i}"),
        )?;
        read_media.push(add_media(
            &clip,
            &mut media,
            &mut by_path,
            &mut media_index,
        )?);
    }

    // 2) 描述幻灯片序列。
    let mut slides: Vec<SlideSpec> = Vec::new();
    // 全文听写
    slides.push(SlideSpec {
        title: "全文听写".into(),
        body: vec![],
        media: Some(full_media),
    });
    // 每句：听写页(仅按钮) + 答案页(按钮+文本)
    for (i, s) in sentences.iter().enumerate() {
        slides.push(SlideSpec {
            title: format!("句子 {} · 听写", i + 1),
            body: vec![],
            media: Some(sent_media[i]),
        });
        slides.push(SlideSpec {
            title: format!("句子 {} · 答案", i + 1),
            body: vec![s.text.clone()],
            media: Some(sent_media[i]),
        });
    }
    // 全文听读
    for (pi, page) in pages.iter().enumerate() {
        slides.push(SlideSpec {
            title: format!("全文听读 {}", pi + 1),
            body: page.iter().map(|&i| sentences[i].text.clone()).collect(),
            media: Some(read_media[pi]),
        });
    }

    // 3) 组装 zip。
    let mut oo = Ooxml::new();
    write_content_types(&mut oo, slides.len(), &media);
    write_root_rels(&mut oo);
    write_docprops(&mut oo, &options.project_name, slides.len());
    write_presentation(&mut oo, slides.len(), &slides);
    write_presentation_rels(&mut oo, slides.len());
    write_theme(&mut oo);
    write_slide_master(&mut oo);
    write_slide_layout(&mut oo);
    // 幻灯片
    for (si, slide) in slides.iter().enumerate() {
        let n = si + 1;
        let media_rid = if slide.media.is_some() {
            Some("rId2".to_string())
        } else {
            None
        };
        write_slide(&mut oo, n, slide, media_rid.as_deref());
        // 该页 rels：rId1 -> layout；如有媒体 rId2 -> media
        let mut rels = String::new();
        rels.push_str(&format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="{NS_R}">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
"#
        ));
        if let Some(m) = slide.media {
            let mc = &media[m];
            rels.push_str(&format!(
                r#"<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/media" Target="../media/{m}.{ext}"/> "#,
                m = m + 1,
                ext = mc.ext
            ));
        }
        // 播放按钮图标（每页共用同一个 play.png）
        rels.push_str(
            r#"<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/play.png"/> "#,
        );
        rels.push_str("</Relationships>");
        oo.add_str(&format!("ppt/slides/_rels/slide{n}.xml.rels"), &rels);
    }
    // 媒体
    for (i, m) in media.iter().enumerate() {
        oo.add(&format!("ppt/media/{}.{}", i + 1, m.ext), m.bytes.clone());
    }
    // 播放按钮图标
    oo.add("ppt/media/play.png", PLAY_PNG.to_vec());

    oo.build()
}

fn write_content_types(oo: &mut Ooxml, slide_count: usize, media: &[MediaClip]) {
    let mut s = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
"#,
    );
    for n in 1..=slide_count {
        s.push_str(&format!(
            "<Override PartName=\"/ppt/slides/slide{n}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slide+xml\"/>\n"
        ));
    }
    // 每个媒体扩展名一个 Default（wav 等）
    let mut seen = std::collections::BTreeSet::new();
    for m in media {
        if seen.insert(m.ext.clone()) {
            let ct = if m.ext == "wav" {
                "audio/wav"
            } else {
                "audio/mpeg"
            };
            s.push_str(&format!(
                "<Default Extension=\"{}\" ContentType=\"{}\"/>\n",
                m.ext, ct
            ));
        }
    }
    s.push_str("</Types>");
    oo.add_str("[Content_Types].xml", &s);
}

fn write_root_rels(oo: &mut Ooxml) {
    oo.add_str(
        "_rels/.rels",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>"#,
    );
}

fn write_docprops(oo: &mut Ooxml, title: &str, slides: usize) {
    let core = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>{{TITLE}}</dc:title>
</cp:coreProperties>"#
        .replace("{{TITLE}}", &escape_xml(title));
    oo.add_str("docProps/core.xml", &core);
    oo.add_str(
        "docProps/app.xml",
        &format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<Application>Material Dictation</Application>
<Slides>{slides}</Slides>
</Properties>"#
        ),
    );
}

fn write_presentation(oo: &mut Ooxml, slide_count: usize, _slides: &[SlideSpec]) {
    let mut s = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="{NS_A}" xmlns:r="{NS_R}" xmlns:p="{NS_P}">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst>
"#
    );
    for n in 0..slide_count {
        s.push_str(&format!(
            "<p:sldId id=\"{}\" r:id=\"rId{}\"/>\n",
            256 + n as i64,
            n + 2
        ));
    }
    s.push_str(&format!(
        r#"</p:sldIdLst>
<p:sldSz cx="{SLIDE_W}" cy="{SLIDE_H}" type="wide"/>
<p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>"#
    ));
    oo.add_str("ppt/presentation.xml", &s);
}

fn write_presentation_rels(oo: &mut Ooxml, slide_count: usize) {
    let mut s = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="{NS_R}">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
"#
    );
    for n in 1..=slide_count {
        s.push_str(&format!(
            "<Relationship Id=\"rId{}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide\" Target=\"slides/slide{n}.xml\"/>\n",
            n + 1
        ));
    }
    s.push_str("</Relationships>");
    oo.add_str("ppt/_rels/presentation.xml.rels", &s);
}

fn write_theme(oo: &mut Ooxml) {
    oo.add_str(
        "ppt/theme/theme1.xml",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office">
<a:themeElements>
<a:clrScheme name="Office">
<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="1F497D"/></a:dk2>
<a:lt2><a:srgbClr val="EEECE1"/></a:lt2>
<a:accent1><a:srgbClr val="0078D4"/></a:accent1>
<a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
<a:accent4><a:srgbClr val="FFC000"/></a:accent4>
<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>
<a:accent6><a:srgbClr val="70AD47"/></a:accent6>
<a:hlink><a:srgbClr val="0563C1"/></a:hlink>
<a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
</a:clrScheme>
<a:fontScheme name="Office">
<a:majorFont><a:latin typeface="Segoe UI"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Segoe UI"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
</a:fontScheme>
<a:fmtScheme name="Office">
<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="50000"/><a:satMod val="300000"/></a:schemeClr></a:gs><a:gs pos="35000"><a:schemeClr val="phClr"><a:tint val="37000"/><a:satMod val="300000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:tint val="15000"/><a:satMod val="350000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="16200000" scaled="1"/></a:gradFill>
<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:shade val="51000"/><a:satMod val="130000"/></a:schemeClr></a:gs><a:gs pos="80000"><a:schemeClr val="phClr"><a:shade val="93000"/><a:satMod val="130000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="94000"/><a:satMod val="135000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="16200000" scaled="0"/></a:gradFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"><a:shade val="95000"/><a:satMod val="105000"/></a:schemeClr></a:solidFill><a:prstDash val="solid"/></a:ln>
<a:ln w="25400" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
<a:ln w="38100" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="40000"/><a:satMod val="350000"/></a:schemeClr></a:gs><a:gs pos="40000"><a:schemeClr val="phClr"><a:tint val="45000"/><a:shade val="99000"/><a:satMod val="350000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="20000"/><a:satMod val="255000"/></a:schemeClr></a:gs></a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="-80000" r="50000" b="180000"/></a:path></a:gradFill>
<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="80000"/><a:satMod val="300000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="30000"/><a:satMod val="200000"/></a:schemeClr></a:gs></a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill></a:bgFillStyleLst>
</a:fmtScheme>
</a:themeElements>
</a:theme>"#,
    );
}

fn write_slide_master(oo: &mut Ooxml) {
    oo.add_str(
        "ppt/slideMasters/slideMaster1.xml",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
</p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
<p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>
</p:sldMaster>"#,
    );
    oo.add_str(
        "ppt/slideMasters/_rels/slideMaster1.xml.rels",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>"#,
    );
}

fn write_slide_layout(oo: &mut Ooxml) {
    oo.add_str(
        "ppt/slideLayouts/slideLayout1.xml",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
<p:cSld name="Blank"><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
</p:spTree></p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>"#,
    );
    oo.add_str(
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>"#,
    );
}

/// 生成单张幻灯片 XML。shape id 从 2 起。
fn write_slide(oo: &mut Ooxml, n: usize, slide: &SlideSpec, media_rid: Option<&str>) {
    let mut shapes = String::new();
    let mut next_id = 2i64;

    // 标题（四周留边距，不贴左上角）
    shapes.push_str(&text_shape(
        next_id,
        MARGIN,
        MARGIN,
        SLIDE_W - 2 * MARGIN,
        1_000_000,
        32,
        true,
        &slide.title,
    ));
    next_id += 1;

    // 正文
    if !slide.body.is_empty() {
        let body_top = MARGIN + 1_100_000;
        shapes.push_str(&text_shape(
            next_id,
            MARGIN,
            body_top,
            SLIDE_W - 2 * MARGIN,
            SLIDE_H - body_top - MARGIN - 1_800_000,
            24,
            false,
            &slide.body.join("\n"),
        ));
        next_id += 1;
    }

    // 播放按钮（音频）
    if let Some(rid) = media_rid {
        shapes.push_str(&play_button(next_id, rid));
    }

    let xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="{NS_A}" xmlns:r="{NS_R}" xmlns:p="{NS_P}">
<p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
{shapes}
</p:spTree></p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>"#
    );
    oo.add_str(&format!("ppt/slides/slide{n}.xml"), &xml);
}

#[allow(clippy::too_many_arguments)]
fn text_shape(id: i64, x: i64, y: i64, w: i64, h: i64, sz: u32, bold: bool, text: &str) -> String {
    // 用换行分段
    let paras: String = text
        .split('\n')
        .map(|line| {
            format!(
                "<a:p><a:r><a:rPr lang=\"zh-CN\" sz=\"{sz}\"{b} dirty=\"0\"/><a:t>{}</a:t></a:r></a:p>",
                escape_xml(line),
                sz = sz * 100,
                b = if bold { " b=\"1\"" } else { "" }
            )
        })
        .collect();
    format!(
        r#"<p:sp>
<p:nvSpPr><p:cNvPr id="{id}" name="tb{id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="t"/><a:lstStyle/>{paras}</p:txBody>
</p:sp>"#
    )
}

/// 一个“播放”按钮（嵌入音频图标），携带嵌入式音频，点击即播放。
/// `rid` = 该页音频媒体 relationship id（rId2）；图标图片固定用 rId3。
fn play_button(id: i64, rid: &str) -> String {
    let w = 1_200_000i64;
    let h = 1_200_000i64;
    let x = SLIDE_W - w - MARGIN; // 右下
    let y = SLIDE_H - h - MARGIN;
    format!(
        r#"<p:pic>
<p:nvPicPr>
<p:cNvPr id="{id}" name="Play"><a:hlinkClick r:id="" action="ppaction://media"/></p:cNvPr>
<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>
<p:nvPr><a:audioFile r:link="{rid}"/></p:nvPr>
</p:nvPicPr>
<p:blipFill><a:blip r:embed="rId3"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
</p:pic>"#
    )
}

fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// 把句子按长度分页，每页至少一句。
fn paginate(sentences: &[PptSentence]) -> Vec<Vec<usize>> {
    const MAX_CHARS: usize = 600;
    let mut pages: Vec<Vec<usize>> = Vec::new();
    let mut cur: Vec<usize> = Vec::new();
    let mut len = 0usize;
    for (i, s) in sentences.iter().enumerate() {
        if !cur.is_empty() && len + s.text.len() > MAX_CHARS {
            pages.push(std::mem::take(&mut cur));
            len = 0;
        }
        cur.push(i);
        len += s.text.len();
    }
    if !cur.is_empty() {
        pages.push(cur);
    }
    if pages.is_empty() {
        pages.push(Vec::new());
    }
    pages
}

fn bake_full(audio: &str, speed: f32, work: &Path) -> Result<PathBuf> {
    let out = work.join("full.wav");
    if (speed - 1.0).abs() < f32::EPSILON {
        std::fs::copy(audio, &out)?;
        return Ok(out);
    }
    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-y")
        .arg("-i")
        .arg(audio)
        .arg("-filter:a")
        .arg(format!("atempo={speed:.4}"))
        .arg("-ac")
        .arg("1")
        .arg("-ar")
        .arg(SAMPLE_RATE.to_string())
        .arg("-c:a")
        .arg("pcm_s16le")
        .arg(&out);
    run_ffmpeg(&mut cmd, "烘焙全文音频失败")?;
    Ok(out)
}

fn bake_sentence(
    audio: &str,
    s: &PptSentence,
    options: &PptOptions,
    work: &Path,
    index: usize,
) -> Result<PathBuf> {
    let times = options.listen_times.max(1) as usize;
    let mut pieces: Vec<PathBuf> = Vec::with_capacity(times * 2);
    for i in 0..times {
        let speed = options.speeds.get(i).copied().unwrap_or(1.0).max(0.25);
        let piece = bake_clip(audio, s.start, s.end, speed, work, &format!("s{index}_{i}"))?;
        pieces.push(piece);
        if options.gap_seconds > 0.0 && i + 1 < times {
            pieces.push(bake_silence(
                options.gap_seconds,
                work,
                &format!("g{index}_{i}"),
            )?);
        }
    }
    let out = work.join(format!("sent{index}.wav"));
    concat_clips(&pieces, &out)?;
    Ok(out)
}

fn bake_clip(
    audio: &str,
    start: f32,
    end: f32,
    speed: f32,
    work: &Path,
    name: &str,
) -> Result<PathBuf> {
    let out = work.join(format!("{name}.wav"));
    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-y")
        .arg("-i")
        .arg(audio)
        .arg("-ss")
        .arg(format!("{start:.3}"));
    if end.is_finite() && end > start {
        cmd.arg("-to").arg(format!("{end:.3}"));
    }
    cmd.arg("-filter:a")
        .arg(format!("atempo={speed:.4}"))
        .arg("-ac")
        .arg("1")
        .arg("-ar")
        .arg(SAMPLE_RATE.to_string())
        .arg("-c:a")
        .arg("pcm_s16le")
        .arg(&out);
    run_ffmpeg(&mut cmd, "烘焙音频片段失败")?;
    Ok(out)
}

fn bake_silence(secs: f32, work: &Path, name: &str) -> Result<PathBuf> {
    let out = work.join(format!("{name}.wav"));
    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-y")
        .arg("-f")
        .arg("lavfi")
        .arg("-i")
        .arg(format!("anullsrc=r={SAMPLE_RATE}:cl=mono"))
        .arg("-t")
        .arg(format!("{secs:.3}"))
        .arg("-c:a")
        .arg("pcm_s16le")
        .arg(&out);
    run_ffmpeg(&mut cmd, "生成静音失败")?;
    Ok(out)
}

fn concat_clips(files: &[PathBuf], out: &Path) -> Result<()> {
    let list_path = out.with_extension("txt");
    let mut list = String::new();
    for f in files {
        list.push_str(&format!(
            "file '{}'\n",
            f.to_string_lossy().replace('\\', "/")
        ));
    }
    std::fs::write(&list_path, list)?;
    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-y")
        .arg("-f")
        .arg("concat")
        .arg("-safe")
        .arg("0")
        .arg("-i")
        .arg(&list_path)
        .arg("-c:a")
        .arg("pcm_s16le")
        .arg(out);
    let result = run_ffmpeg(&mut cmd, "合并音频失败");
    let _ = std::fs::remove_file(&list_path);
    result
}

fn run_ffmpeg(cmd: &mut Command, err_msg: &str) -> Result<()> {
    let status = cmd.status().map_err(|e| Error::Ffmpeg(e.to_string()))?;
    if status.success() {
        Ok(())
    } else {
        Err(Error::Ffmpeg(err_msg.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 需要一个真实 wav + ffmpeg，因此标记为 #[ignore]，CI 不跑；本地用
    /// `cargo test --lib -- --ignored` 运行。
    #[test]
    #[ignore]
    fn structural_media_wide_two_slides_per_sentence() {
        let dir = std::env::temp_dir().join(format!("md_pptx_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let wav = dir.join("src.wav");
        {
            let spec = hound::WavSpec {
                channels: 1,
                sample_rate: 16000,
                bits_per_sample: 16,
                sample_format: hound::SampleFormat::Int,
            };
            let mut w = hound::WavWriter::create(&wav, spec).unwrap();
            for i in 0..(16000 * 3) {
                let v = (0.25 * (i as f32) * 0.05).sin();
                w.write_sample((v * i16::MAX as f32) as i16).unwrap();
            }
            w.finalize().unwrap();
        }
        let opts = PptOptions {
            project_name: "t".into(),
            listen_times: 1,
            speeds: vec![1.0],
            gap_seconds: 0.0,
            full_text_speed: 1.0,
        };
        let sents = vec![
            PptSentence {
                start: 0.0,
                end: 1.2,
                text: "Hello there.".into(),
            },
            PptSentence {
                start: 1.2,
                end: 2.4,
                text: "How are you?".into(),
            },
        ];
        let bytes = build_pptx_bytes(&wav.to_string_lossy(), &sents, &opts, &dir).expect("build");
        let mut arc = zip::ZipArchive::new(std::io::Cursor::new(bytes)).expect("zip");
        let names: Vec<String> = (0..arc.len())
            .map(|i| arc.by_index(i).unwrap().name().to_string())
            .collect();
        let media = names
            .iter()
            .filter(|n| n.starts_with("ppt/media/") && n.ends_with(".wav"))
            .count();
        let slides = names
            .iter()
            .filter(|n| n.starts_with("ppt/slides/slide") && n.ends_with(".xml"))
            .count();
        assert!(media >= 4, "expected >=4 media, got {media}: {names:?}");
        // slides = 1(全文) + 2*2 + 1(听读分页) = 6
        assert_eq!(slides, 6, "slide count wrong: {names:?}");
        let mut pres_buf = Vec::new();
        {
            use std::io::Read;
            let mut f = arc.by_name("ppt/presentation.xml").unwrap();
            f.read_to_end(&mut pres_buf).unwrap();
        }
        let pres = String::from_utf8_lossy(&pres_buf).into_owned();
        assert!(
            pres.contains("12192000") && pres.contains("wide"),
            "not wide16:9"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
