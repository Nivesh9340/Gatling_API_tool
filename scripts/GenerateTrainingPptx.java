import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import javax.imageio.ImageIO;

public final class GenerateTrainingPptx {
  private GenerateTrainingPptx() {}

  private record Slide(String title, List<String> bullets, String imageName) {}

  public static void main(String[] args) throws Exception {
    Path root = Path.of("c:\\Users\\nives\\Desktop\\myfiles\\Tools\\Kubernetes\\gatling-api-tool");
    Path out = root.resolve("dist").resolve("Gatling-API-Tool-Training.pptx");
    Files.createDirectories(out.getParent());

    List<Slide> slides = buildSlides();
    try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(out))) {
      write(zip, "[Content_Types].xml", contentTypes(slides.size()));
      write(zip, "_rels/.rels", rootRels());
      write(zip, "docProps/app.xml", appProps(slides.size()));
      write(zip, "docProps/core.xml", coreProps());

      write(zip, "ppt/presentation.xml", presentation(slides.size()));
      write(zip, "ppt/_rels/presentation.xml.rels", presentationRels(slides.size()));
      write(zip, "ppt/theme/theme1.xml", theme1());
      write(zip, "ppt/slideMasters/slideMaster1.xml", slideMaster());
      write(zip, "ppt/slideMasters/_rels/slideMaster1.xml.rels", slideMasterRels());
      write(zip, "ppt/slideLayouts/slideLayout1.xml", slideLayout());
      write(zip, "ppt/slideLayouts/_rels/slideLayout1.xml.rels", slideLayoutRels());

      int imageCounter = 1;
      for (int i = 0; i < slides.size(); i++) {
        Slide s = slides.get(i);
        String slidePath = "ppt/slides/slide" + (i + 1) + ".xml";
        String relPath = "ppt/slides/_rels/slide" + (i + 1) + ".xml.rels";
        int imageId = 0;
        if (s.imageName != null) {
          imageId = imageCounter++;
          writePng(zip, "ppt/media/" + s.imageName, renderImage(s.imageName));
        }
        write(zip, slidePath, slideXml(s, imageId));
        write(zip, relPath, slideRels(imageId, s.imageName));
      }
    }

    System.out.println("Created: " + out);
  }

  private static List<Slide> buildSlides() {
    List<Slide> s = new ArrayList<>();
    s.add(new Slide(
        "Gatling API Tool Training",
        List.of(
            "Installation to expert scenario setup",
            "Covers preview + real Gatling execution",
            "Includes troubleshooting and release flow"),
        "img1.png"));
    s.add(new Slide(
        "Installation and First Start",
        List.of(
            "Unzip project anywhere on disk",
            "Run check-prerequisites.bat",
            "Start with start-ui-workspace.bat",
            "Verify runner API is http://127.0.0.1:8787"),
        "img2.png"));
    s.add(new Slide(
        "Workflow Overview",
        List.of(
            "1. Apps & Service: base URL, auth, assertions",
            "2. Load & Scenarios: scenario steps + injection profiles",
            "3. Run Setup: generate YAML/Scala, run real load",
            "4. Reports: KPIs, failures, embedded report"),
        null));
    s.add(new Slide(
        "Advanced Scenario Features",
        List.of(
            "Headers, query params, form params, body/bodyFile",
            "Checks: bodyContains, jsonPathExists, jsonPathEquals",
            "Captures with saveAs and reuse via #{var}",
            "Multipart upload and request behavior flags"),
        "img3.png"));
    s.add(new Slide(
        "Expert / Raw Mode",
        List.of(
            "Switch to Expert / Raw mode in UI",
            "Sync Generated YAML Into Editor",
            "Turn Use Raw YAML On only for targeted overrides",
            "Real runs + YAML download use raw content when enabled"),
        "img4.png"));
    s.add(new Slide(
        "Real Gatling Run and Diagnostics",
        List.of(
            "Use Check Runner before Run Real Load",
            "Monitor status tiles and live diagnostics",
            "Use report iframe and failure tables for root cause",
            "Use saved suites for repeatable regression"),
        null));
    s.add(new Slide(
        "Portable Packaging and Release",
        List.of(
            "create-portable-bundle.bat creates timestamped zip",
            "build-release.bat runs checks + package + checksum",
            "dist/latest-bundle.txt stores latest artifact path",
            "dist/latest-bundle.sha256 stores integrity hash"),
        null));
    s.add(new Slide(
        "Demo Plan (Recommended)",
        List.of(
            "Create app + QA environment",
            "Add feeder, checks, captures, injection profile",
            "Run preview, then run real Gatling",
            "Review p95/p99 and save suite"),
        null));
    return s;
  }

  private static String esc(String s) {
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
  }

  private static String slideXml(Slide s, int imageId) {
    StringBuilder body = new StringBuilder();
    body.append(paragraph(s.title, true));
    for (String b : s.bullets) body.append(paragraph("• " + b, false));
    String pic = "";
    if (imageId > 0) {
      pic = """
      <p:pic>
        <p:nvPicPr>
          <p:cNvPr id="30" name="Picture"/>
          <p:cNvPicPr/>
          <p:nvPr/>
        </p:nvPicPr>
        <p:blipFill>
          <a:blip r:embed="rId2"/>
          <a:stretch><a:fillRect/></a:stretch>
        </p:blipFill>
        <p:spPr>
          <a:xfrm><a:off x="6858000" y="1200000"/><a:ext cx="4800000" cy="3600000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
      </p:pic>
      """;
    }
    return """
    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
           xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
           xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:cSld>
        <p:spTree>
          <p:nvGrpSpPr>
            <p:cNvPr id="1" name=""/>
            <p:cNvGrpSpPr/>
            <p:nvPr/>
          </p:nvGrpSpPr>
          <p:grpSpPr>
            <a:xfrm>
              <a:off x="0" y="0"/>
              <a:ext cx="0" cy="0"/>
              <a:chOff x="0" y="0"/>
              <a:chExt cx="0" cy="0"/>
            </a:xfrm>
          </p:grpSpPr>
          <p:sp>
            <p:nvSpPr>
              <p:cNvPr id="2" name="Title"/>
              <p:cNvSpPr/>
              <p:nvPr/>
            </p:nvSpPr>
            <p:spPr><a:xfrm><a:off x="457200" y="228600"/><a:ext cx="11300000" cy="600000"/></a:xfrm></p:spPr>
            <p:txBody>
              <a:bodyPr/>
              <a:lstStyle/>
              """ + paragraph(s.title, true) + """
            </p:txBody>
          </p:sp>
          <p:sp>
            <p:nvSpPr>
              <p:cNvPr id="3" name="Body"/>
              <p:cNvSpPr/>
              <p:nvPr/>
            </p:nvSpPr>
            <p:spPr><a:xfrm><a:off x="457200" y="1066800"/><a:ext cx="6200000" cy="5200000"/></a:xfrm></p:spPr>
            <p:txBody>
              <a:bodyPr/>
              <a:lstStyle/>
              """ + body + """
            </p:txBody>
          </p:sp>
          """ + pic + """
        </p:spTree>
      </p:cSld>
      <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
    </p:sld>
    """;
  }

  private static String paragraph(String text, boolean title) {
    if (title) {
      return "<a:p><a:r><a:rPr lang=\"en-US\" sz=\"3400\" b=\"1\"/><a:t>" + esc(text)
          + "</a:t></a:r><a:endParaRPr lang=\"en-US\"/></a:p>";
    }
    return "<a:p><a:r><a:rPr lang=\"en-US\" sz=\"2000\"/><a:t>" + esc(text)
        + "</a:t></a:r><a:endParaRPr lang=\"en-US\"/></a:p>";
  }

  private static String slideRels(int imageId, String imageName) {
    String imgRel = "";
    if (imageId > 0 && imageName != null) {
      imgRel = "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"../media/"
          + imageName + "\"/>";
    }
    return """
    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
      """ + imgRel + """
    </Relationships>
    """;
  }

  private static String presentation(int count) {
    StringBuilder ids = new StringBuilder();
    for (int i = 0; i < count; i++) {
      ids.append("<p:sldId id=\"").append(256 + i).append("\" r:id=\"rId").append(i + 2).append("\"/>");
    }
    StringBuilder out = new StringBuilder();
    out.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
    out.append("<p:presentation xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" ");
    out.append("xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" ");
    out.append("xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">");
    out.append("<p:sldMasterIdLst><p:sldMasterId id=\"2147483648\" r:id=\"rId1\"/></p:sldMasterIdLst>");
    out.append("<p:sldIdLst>").append(ids).append("</p:sldIdLst>");
    out.append("<p:sldSz cx=\"12192000\" cy=\"6858000\" type=\"screen16x9\"/>");
    out.append("<p:notesSz cx=\"6858000\" cy=\"9144000\"/>");
    out.append("<p:defaultTextStyle/>");
    out.append("</p:presentation>");
    return out.toString();
  }

  private static String presentationRels(int count) {
    StringBuilder rels = new StringBuilder();
    rels.append("<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster\" Target=\"slideMasters/slideMaster1.xml\"/>");
    for (int i = 0; i < count; i++) {
      rels.append("<Relationship Id=\"rId").append(i + 2)
          .append("\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide\" Target=\"slides/slide")
          .append(i + 1).append(".xml\"/>");
    }
    return """
    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      """ + rels + """
    </Relationships>
    """;
  }

  private static String slideMaster() {
    return """
    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                 xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:cSld name="Master">
        <p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>
        <p:spTree>
          <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
          <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
        </p:spTree>
      </p:cSld>
      <p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/>
      <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
      <p:txStyles/>
    </p:sldMaster>
    """;
  }

  private static String slideMasterRels() {
    return """
    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
    </Relationships>
    """;
  }

  private static String slideLayout() {
    return """
    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                 xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                 type="blank" preserve="1">
      <p:cSld name="Blank">
        <p:spTree>
          <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
          <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
        </p:spTree>
      </p:cSld>
      <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
    </p:sldLayout>
    """;
  }

  private static String slideLayoutRels() {
    return """
    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
    </Relationships>
    """;
  }

  private static String theme1() {
    return """
    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Simple Theme">
      <a:themeElements>
        <a:clrScheme name="Simple">
          <a:dk1><a:srgbClr val="1F2937"/></a:dk1>
          <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
          <a:dk2><a:srgbClr val="111827"/></a:dk2>
          <a:lt2><a:srgbClr val="F3F4F6"/></a:lt2>
          <a:accent1><a:srgbClr val="2563EB"/></a:accent1>
          <a:accent2><a:srgbClr val="059669"/></a:accent2>
          <a:accent3><a:srgbClr val="D97706"/></a:accent3>
          <a:accent4><a:srgbClr val="DC2626"/></a:accent4>
          <a:accent5><a:srgbClr val="7C3AED"/></a:accent5>
          <a:accent6><a:srgbClr val="0EA5E9"/></a:accent6>
          <a:hlink><a:srgbClr val="2563EB"/></a:hlink>
          <a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink>
        </a:clrScheme>
        <a:fontScheme name="Simple">
          <a:majorFont><a:latin typeface="Calibri"/></a:majorFont>
          <a:minorFont><a:latin typeface="Calibri"/></a:minorFont>
        </a:fontScheme>
        <a:fmtScheme name="Simple"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme>
      </a:themeElements>
      <a:objectDefaults/>
      <a:extraClrSchemeLst/>
    </a:theme>
    """;
  }

  private static String contentTypes(int slideCount) {
    StringBuilder overrides = new StringBuilder();
    for (int i = 1; i <= slideCount; i++) {
      overrides.append("<Override PartName=\"/ppt/slides/slide").append(i)
          .append(".xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slide+xml\"/>");
    }
    return """
    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
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
      """ + overrides + """
    </Types>
    """;
  }

  private static String rootRels() {
    return """
    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
      <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
    </Relationships>
    """;
  }

  private static String appProps(int slides) {
    StringBuilder out = new StringBuilder();
    out.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
    out.append("<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\" ");
    out.append("xmlns:vt=\"http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes\">");
    out.append("<Application>Codex</Application>");
    out.append("<PresentationFormat>On-screen Show (16:9)</PresentationFormat>");
    out.append("<Slides>").append(slides).append("</Slides>");
    out.append("<Notes>0</Notes><HiddenSlides>0</HiddenSlides><MMClips>0</MMClips><ScaleCrop>false</ScaleCrop>");
    out.append("<HeadingPairs><vt:vector size=\"2\" baseType=\"variant\"><vt:variant><vt:lpstr>Slides</vt:lpstr></vt:variant><vt:variant><vt:i4>")
        .append(slides)
        .append("</vt:i4></vt:variant></vt:vector></HeadingPairs>");
    out.append("<TitlesOfParts><vt:vector size=\"").append(slides).append("\" baseType=\"lpstr\"></vt:vector></TitlesOfParts>");
    out.append("<Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged>");
    out.append("<AppVersion>16.0000</AppVersion>");
    out.append("</Properties>");
    return out.toString();
  }

  private static String coreProps() {
    String date = LocalDate.now().toString() + "T00:00:00Z";
    StringBuilder out = new StringBuilder();
    out.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
    out.append("<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" ");
    out.append("xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" ");
    out.append("xmlns:dcmitype=\"http://purl.org/dc/dcmitype/\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">");
    out.append("<dc:title>Gatling API Tool Training</dc:title>");
    out.append("<dc:creator>Codex</dc:creator>");
    out.append("<cp:lastModifiedBy>Codex</cp:lastModifiedBy>");
    out.append("<dcterms:created xsi:type=\"dcterms:W3CDTF\">").append(date).append("</dcterms:created>");
    out.append("<dcterms:modified xsi:type=\"dcterms:W3CDTF\">").append(date).append("</dcterms:modified>");
    out.append("</cp:coreProperties>");
    return out.toString();
  }

  private static BufferedImage renderImage(String name) {
    BufferedImage img = new BufferedImage(1200, 700, BufferedImage.TYPE_INT_RGB);
    Graphics2D g = img.createGraphics();
    g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
    g.setColor(new Color(243, 246, 252));
    g.fillRect(0, 0, 1200, 700);
    g.setColor(new Color(31, 41, 55));
    g.setFont(new Font("Segoe UI", Font.BOLD, 42));
    g.drawString("Gatling API Tool", 60, 90);
    g.setColor(new Color(37, 99, 235));
    g.setStroke(new BasicStroke(4f));
    g.drawRoundRect(50, 120, 1100, 520, 24, 24);

    g.setFont(new Font("Segoe UI", Font.PLAIN, 28));
    g.setColor(new Color(17, 24, 39));
    if ("img1.png".equals(name)) {
      g.drawString("Installation + Workflow Overview", 90, 190);
      drawChip(g, 90, 230, "Install");
      drawChip(g, 250, 230, "Configure");
      drawChip(g, 430, 230, "Run");
      drawChip(g, 560, 230, "Analyze");
    } else if ("img2.png".equals(name)) {
      g.drawString("Setup Commands", 90, 190);
      g.setFont(new Font("Consolas", Font.PLAIN, 26));
      g.drawString("check-prerequisites.bat", 90, 250);
      g.drawString("start-ui-workspace.bat", 90, 300);
      g.drawString("build-release.bat", 90, 350);
    } else if ("img3.png".equals(name)) {
      g.drawString("Advanced Features", 90, 190);
      drawChip(g, 90, 230, "Checks");
      drawChip(g, 250, 230, "Captures");
      drawChip(g, 430, 230, "Branching");
      drawChip(g, 650, 230, "Multipart");
      drawChip(g, 860, 230, "TLS/Auth");
    } else {
      g.drawString("Expert / Raw YAML", 90, 190);
      g.setFont(new Font("Consolas", Font.PLAIN, 24));
      g.drawString("Sync Generated YAML Into Editor", 90, 260);
      g.drawString("Use Raw YAML: On", 90, 305);
      g.drawString("Run Real Load (Gatling)", 90, 350);
    }
    g.dispose();
    return img;
  }

  private static void drawChip(Graphics2D g, int x, int y, String label) {
    g.setColor(new Color(219, 234, 254));
    g.fillRoundRect(x, y, 140, 44, 20, 20);
    g.setColor(new Color(30, 64, 175));
    g.drawRoundRect(x, y, 140, 44, 20, 20);
    g.setFont(new Font("Segoe UI", Font.BOLD, 20));
    g.drawString(label, x + 20, y + 30);
  }

  private static void write(ZipOutputStream zip, String path, String xml) throws IOException {
    ZipEntry e = new ZipEntry(path);
    zip.putNextEntry(e);
    zip.write(xml.getBytes(StandardCharsets.UTF_8));
    zip.closeEntry();
  }

  private static void writePng(ZipOutputStream zip, String path, BufferedImage image) throws IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    ImageIO.write(image, "png", out);
    ZipEntry e = new ZipEntry(path);
    zip.putNextEntry(e);
    zip.write(out.toByteArray());
    zip.closeEntry();
  }
}
