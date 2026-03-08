import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import javax.imageio.ImageIO;

public final class GenerateTrainingPptxBranded {
  private GenerateTrainingPptxBranded() {}

  private static final Color BRAND_PRIMARY = new Color(15, 92, 192);
  private static final Color BRAND_SECONDARY = new Color(17, 132, 91);
  private static final Color BG = new Color(243, 247, 252);
  private static final Color TEXT = new Color(20, 31, 46);

  private record Slide(String title, List<String> bullets, String imageName) {}

  public static void main(String[] args) throws Exception {
    Path root = Path.of("c:\\Users\\nives\\Desktop\\myfiles\\Tools\\Kubernetes\\gatling-api-tool");
    Path assets = root.resolve("assets").resolve("presentation");
    Path out = root.resolve("dist").resolve("Gatling-API-Tool-Scenario-Runbook.pptx");
    Files.createDirectories(out.getParent());
    Files.createDirectories(assets);

    List<Slide> slides = buildSlides();
    try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(out))) {
      write(zip, "[Content_Types].xml", contentTypes(slides.size()));
      write(zip, "_rels/.rels", rootRels());
      write(zip, "docProps/app.xml", appProps(slides.size()));
      write(zip, "docProps/core.xml", coreProps());
      write(zip, "ppt/presentation.xml", presentation(slides.size()));
      write(zip, "ppt/_rels/presentation.xml.rels", presentationRels(slides.size()));
      write(zip, "ppt/presProps.xml", presProps());
      write(zip, "ppt/viewProps.xml", viewProps());
      write(zip, "ppt/tableStyles.xml", tableStyles());
      write(zip, "ppt/theme/theme1.xml", theme1());
      write(zip, "ppt/slideMasters/slideMaster1.xml", slideMaster());
      write(zip, "ppt/slideMasters/_rels/slideMaster1.xml.rels", slideMasterRels());
      write(zip, "ppt/slideLayouts/slideLayout1.xml", slideLayout());
      write(zip, "ppt/slideLayouts/_rels/slideLayout1.xml.rels", slideLayoutRels());

      Set<String> writtenImages = new HashSet<>();
      for (int i = 0; i < slides.size(); i++) {
        Slide s = slides.get(i);
        String slidePath = "ppt/slides/slide" + (i + 1) + ".xml";
        String relPath = "ppt/slides/_rels/slide" + (i + 1) + ".xml.rels";
        if (!writtenImages.contains(s.imageName)) {
          writePng(zip, "ppt/media/" + s.imageName, loadOrRenderImage(assets.resolve(s.imageName), i + 1, s.title));
          writtenImages.add(s.imageName);
        }
        write(zip, slidePath, slideXml(s));
        write(zip, relPath, slideRels(s.imageName));
      }
    }

    writeAssetReadme(assets);
    System.out.println("Created: " + out);
    System.out.println("Drop real screenshots in: " + assets);
    System.out.println("Expected names: slide1.png ... slide14.png (slide9 reused for conditional examples)");
  }

  private static void writeAssetReadme(Path assets) throws IOException {
    Path readme = assets.resolve("README.txt");
    if (Files.exists(readme)) return;
    Files.writeString(
        readme,
        "Place real screenshots here with names:\n"
            + "slide1.png ... slide8.png\n\n"
            + "Then run:\n"
            + "java scripts\\GenerateTrainingPptxBranded.java\n",
        StandardCharsets.UTF_8);
  }

  private static List<Slide> buildSlides() {
    List<Slide> s = new ArrayList<>();
    s.add(new Slide("Gatling API Tool: Orders QA Scenario Runbook",
        List.of("Project: orders-service performance validation", "Mode: preview + real backend Gatling", "Objective: stable p95 and 99%+ success"), "slide1.png"));
    s.add(new Slide("Step 1: Install and Start Workspace",
        List.of("Run check-prerequisites.bat", "Run start-ui-workspace.bat", "Runner API target: http://127.0.0.1:8787"), "slide2.png"));
    s.add(new Slide("Scenario We Will Build",
        List.of("Application: orders-service", "Environment: qa", "Flow: GET /orders -> GET /orders/#{orderId} -> POST /orders", "Assertions: success >= 99, p95 <= 1200ms"), "slide3.png"));
    s.add(new Slide("Step 2: Base Service and App Setup",
        List.of("Base URL: https://qa.api.company.com", "Auth: bearer token from API_TOKEN", "Global assertions: success 99, maxRT 2000, p95 1200"), "slide4.png"));
    s.add(new Slide("Step 3: Injection Profile Design",
        List.of("smoke_5: 5 users / 15 sec", "baseline_20: ramp 20 users / 60 sec", "stress_80: ramp 80 users / 180 sec"), "slide5.png"));
    s.add(new Slide("Step 4: Core Scenario Steps",
        List.of("Step1 List Orders: GET /orders expected 200", "Step2 Get Order: GET /orders/#{orderId} expected 200", "Step3 Create Order: POST /orders expected 201"), "slide6.png"));
    s.add(new Slide("Step 5: Checks and Captures",
        List.of("Checks: jsonPathExists($.items[0].id), bodyContains(\"order\")", "Capture: $.items[0].id -> orderId", "Use #{orderId} in step 2 path"), "slide7.png"));
    s.add(new Slide("Step 6: Feeders, Params, and Body Files",
        List.of("Feeder file: src/test/resources/data/users.csv", "Mode: circular for repeatability", "POST body: bodyFile src/test/resources/bodies/create-order.json"), "slide8.png"));
    s.add(new Slide("Step 7: Branching and Request Flags",
        List.of("Conditional if/else: if #{customerTier} == premium then /orders/premium", "Else fallback route: /orders/standard", "Example operator set: equals, notEquals, contains, exists", "Flags: timeout 30000, disableFollowRedirect=true for validation"), "slide9.png"));
    s.add(new Slide("Conditional Statement Example (YAML)",
        List.of(
            "when: variable=customerTier operator=equals value=premium",
            "then: method=GET path=/orders/premium expectedStatus=200",
            "else: method=GET elsePath=/orders/standard elseExpectedStatus=200",
            "Use captures from prior step to drive the branch input"),
        "slide9.png"));
    s.add(new Slide("Step 8: Multipart, TLS, and Auth Variants",
        List.of("Upload endpoint example: POST /orders/import with formUploads", "TLS: trustStore from env-backed password", "Environment auth override allowed for qa/prod-like"), "slide10.png"));
    s.add(new Slide("Step 9: Expert / Raw YAML Mode",
        List.of("Click Sync Generated YAML Into Editor", "Turn Use Raw YAML On for only required overrides", "Recommended: retain profile names + assertion blocks unchanged"), "slide11.png"));
    s.add(new Slide("Step 10: Real Gatling Run",
        List.of("Click Check Runner -> expect healthy", "Click Run Real Load (Gatling)", "Track job ID and output tail until report availability = Final"), "slide12.png"));
    s.add(new Slide("Step 11: Report Analysis and Troubleshooting",
        List.of("KPI gates: success >= 99, p95 <= 1200, p99 <= 2000", "Review top failure reasons table first", "Use parity diagnostics to separate preview artifacts"), "slide13.png"));
    s.add(new Slide("Step 12: Save Suites and Release",
        List.of("Save suite as: orders-qa-regression", "Run build-release.bat for package + checksum", "Share dist zip + latest-bundle.sha256 to downstream teams"), "slide14.png"));
    return s;
  }

  private static BufferedImage loadOrRenderImage(Path imagePath, int idx, String title) throws IOException {
    if (Files.exists(imagePath)) {
      try (InputStream in = Files.newInputStream(imagePath)) {
        BufferedImage img = ImageIO.read(in);
        if (img != null) return img;
      }
    }
    return renderFallback(idx, title);
  }

  private static BufferedImage renderFallback(int idx, String title) {
    BufferedImage img = new BufferedImage(1280, 720, BufferedImage.TYPE_INT_RGB);
    Graphics2D g = img.createGraphics();
    g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
    g.setColor(BG);
    g.fillRect(0, 0, 1280, 720);
    g.setColor(BRAND_PRIMARY);
    g.fillRoundRect(36, 36, 1208, 648, 28, 28);
    g.setColor(new Color(255, 255, 255, 245));
    g.fillRoundRect(58, 74, 1164, 590, 22, 22);
    g.setColor(BRAND_SECONDARY);
    g.setStroke(new BasicStroke(6f));
    g.drawRoundRect(88, 118, 1104, 500, 20, 20);
    g.setColor(TEXT);
    g.setFont(new Font("Segoe UI", Font.BOLD, 38));
    g.drawString("Slide " + idx, 110, 180);
    g.setFont(new Font("Segoe UI", Font.PLAIN, 30));
    g.drawString(title, 110, 230);
    g.setFont(new Font("Segoe UI", Font.PLAIN, 22));
    g.drawString("Add real screenshot: assets/presentation/slide" + idx + ".png", 110, 290);
    g.dispose();
    return img;
  }

  private static String esc(String s) {
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
  }

  private static String p(String text, boolean title) {
    if (title) return "<a:p><a:r><a:rPr lang=\"en-US\" sz=\"3400\" b=\"1\"/><a:t>" + esc(text) + "</a:t></a:r><a:endParaRPr lang=\"en-US\"/></a:p>";
    return "<a:p><a:r><a:rPr lang=\"en-US\" sz=\"2000\"/><a:t>" + esc(text) + "</a:t></a:r><a:endParaRPr lang=\"en-US\"/></a:p>";
  }

  private static String slideXml(Slide s) {
    StringBuilder body = new StringBuilder();
    for (String b : s.bullets) body.append(p("• " + b, false));
    return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<p:sld xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" "
        + "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" "
        + "xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">"
        + "<p:cSld><p:spTree>"
        + "<p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>"
        + "<p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>"
        + "<p:sp><p:nvSpPr><p:cNvPr id=\"2\" name=\"Title\"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>"
        + "<p:spPr><a:xfrm><a:off x=\"457200\" y=\"228600\"/><a:ext cx=\"11300000\" cy=\"600000\"/></a:xfrm></p:spPr>"
        + "<p:txBody><a:bodyPr/><a:lstStyle/>" + p(s.title, true) + "</p:txBody></p:sp>"
        + "<p:sp><p:nvSpPr><p:cNvPr id=\"3\" name=\"Body\"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>"
        + "<p:spPr><a:xfrm><a:off x=\"457200\" y=\"1066800\"/><a:ext cx=\"5600000\" cy=\"5200000\"/></a:xfrm></p:spPr>"
        + "<p:txBody><a:bodyPr/><a:lstStyle/>" + body + "</p:txBody></p:sp>"
        + "<p:pic><p:nvPicPr><p:cNvPr id=\"30\" name=\"Picture\"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>"
        + "<p:blipFill><a:blip r:embed=\"rId2\"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>"
        + "<p:spPr><a:xfrm><a:off x=\"6400000\" y=\"1150000\"/><a:ext cx=\"5400000\" cy=\"3600000\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></p:spPr>"
        + "</p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>";
  }

  private static String slideRels(String imageName) {
    return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
        + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout\" Target=\"../slideLayouts/slideLayout1.xml\"/>"
        + "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"../media/" + imageName + "\"/>"
        + "</Relationships>";
  }

  private static String presentation(int count) {
    StringBuilder ids = new StringBuilder();
    for (int i = 0; i < count; i++) ids.append("<p:sldId id=\"").append(256 + i).append("\" r:id=\"rId").append(i + 2).append("\"/>");
    return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<p:presentation xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">"
        + "<p:sldMasterIdLst><p:sldMasterId id=\"2147483648\" r:id=\"rId1\"/></p:sldMasterIdLst>"
        + "<p:sldIdLst>" + ids + "</p:sldIdLst>"
        + "<p:sldSz cx=\"12192000\" cy=\"6858000\" type=\"screen16x9\"/>"
        + "<p:notesSz cx=\"6858000\" cy=\"9144000\"/>"
        + "<p:defaultTextStyle/>"
        + "</p:presentation>";
  }

  private static String presentationRels(int count) {
    StringBuilder rels = new StringBuilder();
    rels.append("<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster\" Target=\"slideMasters/slideMaster1.xml\"/>");
    for (int i = 0; i < count; i++) rels.append("<Relationship Id=\"rId").append(i + 2).append("\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide\" Target=\"slides/slide").append(i + 1).append(".xml\"/>");
    int base = count + 2;
    rels.append("<Relationship Id=\"rId").append(base).append("\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps\" Target=\"presProps.xml\"/>");
    rels.append("<Relationship Id=\"rId").append(base + 1).append("\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps\" Target=\"viewProps.xml\"/>");
    rels.append("<Relationship Id=\"rId").append(base + 2).append("\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles\" Target=\"tableStyles.xml\"/>");
    return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
        + rels + "</Relationships>";
  }

  private static String presProps() {
    return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<p:presentationPr xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" "
        + "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" "
        + "xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\"/>";
  }

  private static String viewProps() {
    return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<p:viewPr xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" "
        + "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" "
        + "xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">"
        + "<p:normalViewPr><p:restoredLeft sz=\"15620\"/><p:restoredTop sz=\"94660\"/></p:normalViewPr>"
        + "<p:slideViewPr><p:cSldViewPr snapToGrid=\"1\"/><p:guideLst/></p:slideViewPr>"
        + "<p:notesTextViewPr><p:cViewPr/></p:notesTextViewPr>"
        + "<p:gridSpacing cx=\"72008\" cy=\"72008\"/>"
        + "</p:viewPr>";
  }

  private static String tableStyles() {
    return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<a:tblStyleLst xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" def=\"{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}\"/>";
  }

  private static String slideMaster() {
    return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<p:sldMaster xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">"
        + "<p:cSld name=\"Master\"><p:bg><p:bgRef idx=\"1001\"><a:schemeClr val=\"bg1\"/></p:bgRef></p:bg><p:spTree>"
        + "<p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>"
        + "<p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>"
        + "</p:spTree></p:cSld>"
        + "<p:clrMap accent1=\"accent1\" accent2=\"accent2\" accent3=\"accent3\" accent4=\"accent4\" accent5=\"accent5\" accent6=\"accent6\" bg1=\"lt1\" bg2=\"lt2\" folHlink=\"folHlink\" hlink=\"hlink\" tx1=\"dk1\" tx2=\"dk2\"/>"
        + "<p:sldLayoutIdLst><p:sldLayoutId id=\"2147483649\" r:id=\"rId1\"/></p:sldLayoutIdLst><p:txStyles/></p:sldMaster>";
  }

  private static String slideMasterRels() {
    return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
        + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout\" Target=\"../slideLayouts/slideLayout1.xml\"/>"
        + "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme\" Target=\"../theme/theme1.xml\"/>"
        + "</Relationships>";
  }

  private static String slideLayout() {
    return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<p:sldLayout xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" type=\"blank\" preserve=\"1\">"
        + "<p:cSld name=\"Blank\"><p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>"
        + "<p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>"
        + "</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>";
  }

  private static String slideLayoutRels() {
    return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
        + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster\" Target=\"../slideMasters/slideMaster1.xml\"/>"
        + "</Relationships>";
  }

  private static String theme1() {
    return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<a:theme xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" name=\"Branded\">"
        + "<a:themeElements><a:clrScheme name=\"Branded\">"
        + "<a:dk1><a:srgbClr val=\"1F2937\"/></a:dk1><a:lt1><a:srgbClr val=\"FFFFFF\"/></a:lt1>"
        + "<a:dk2><a:srgbClr val=\"111827\"/></a:dk2><a:lt2><a:srgbClr val=\"F3F4F6\"/></a:lt2>"
        + "<a:accent1><a:srgbClr val=\"0F5CC0\"/></a:accent1><a:accent2><a:srgbClr val=\"11845B\"/></a:accent2>"
        + "<a:accent3><a:srgbClr val=\"D97706\"/></a:accent3><a:accent4><a:srgbClr val=\"DC2626\"/></a:accent4>"
        + "<a:accent5><a:srgbClr val=\"0EA5E9\"/></a:accent5><a:accent6><a:srgbClr val=\"7C3AED\"/></a:accent6>"
        + "<a:hlink><a:srgbClr val=\"2563EB\"/></a:hlink><a:folHlink><a:srgbClr val=\"7C3AED\"/></a:folHlink>"
        + "</a:clrScheme><a:fontScheme name=\"Branded\"><a:majorFont><a:latin typeface=\"Calibri\"/></a:majorFont><a:minorFont><a:latin typeface=\"Calibri\"/></a:minorFont></a:fontScheme>"
        + "<a:fmtScheme name=\"Branded\"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements>"
        + "<a:objectDefaults/><a:extraClrSchemeLst/></a:theme>";
  }

  private static String contentTypes(int slideCount) {
    StringBuilder overrides = new StringBuilder();
    for (int i = 1; i <= slideCount; i++) {
      overrides.append("<Override PartName=\"/ppt/slides/slide").append(i)
          .append(".xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slide+xml\"/>");
    }
    return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
        + "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
        + "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
        + "<Default Extension=\"png\" ContentType=\"image/png\"/>"
        + "<Override PartName=\"/ppt/presentation.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml\"/>"
        + "<Override PartName=\"/ppt/slideMasters/slideMaster1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml\"/>"
        + "<Override PartName=\"/ppt/slideLayouts/slideLayout1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml\"/>"
        + "<Override PartName=\"/ppt/theme/theme1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.theme+xml\"/>"
        + "<Override PartName=\"/ppt/presProps.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.presProps+xml\"/>"
        + "<Override PartName=\"/ppt/viewProps.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml\"/>"
        + "<Override PartName=\"/ppt/tableStyles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml\"/>"
        + "<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>"
        + "<Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/>"
        + overrides + "</Types>";
  }

  private static String rootRels() {
    return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
        + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"ppt/presentation.xml\"/>"
        + "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>"
        + "<Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties\" Target=\"docProps/app.xml\"/>"
        + "</Relationships>";
  }

  private static String appProps(int slides) {
    StringBuilder parts = new StringBuilder();
    for (int i = 1; i <= slides; i++) {
      parts.append("<vt:lpstr>Slide ").append(i).append("</vt:lpstr>");
    }
    return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\" xmlns:vt=\"http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes\">"
        + "<Application>Codex</Application><PresentationFormat>On-screen Show (16:9)</PresentationFormat>"
        + "<Slides>" + slides + "</Slides><Notes>0</Notes><HiddenSlides>0</HiddenSlides><MMClips>0</MMClips><ScaleCrop>false</ScaleCrop>"
        + "<HeadingPairs><vt:vector size=\"2\" baseType=\"variant\"><vt:variant><vt:lpstr>Slides</vt:lpstr></vt:variant><vt:variant><vt:i4>" + slides + "</vt:i4></vt:variant></vt:vector></HeadingPairs>"
        + "<TitlesOfParts><vt:vector size=\"" + slides + "\" baseType=\"lpstr\">" + parts + "</vt:vector></TitlesOfParts>"
        + "<Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion>"
        + "</Properties>";
  }

  private static String coreProps() {
    String date = LocalDate.now().toString() + "T00:00:00Z";
    return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" "
        + "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" "
        + "xmlns:dcmitype=\"http://purl.org/dc/dcmitype/\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">"
        + "<dc:title>Gatling API Tool Training (Branded)</dc:title><dc:creator>Codex</dc:creator><cp:lastModifiedBy>Codex</cp:lastModifiedBy>"
        + "<dcterms:created xsi:type=\"dcterms:W3CDTF\">" + date + "</dcterms:created>"
        + "<dcterms:modified xsi:type=\"dcterms:W3CDTF\">" + date + "</dcterms:modified></cp:coreProperties>";
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
