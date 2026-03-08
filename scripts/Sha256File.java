import java.io.FileInputStream;
import java.nio.file.Path;
import java.security.MessageDigest;

public final class Sha256File {
  private Sha256File() {
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 1) {
      System.err.println("Usage: java Sha256File.java <file>");
      System.exit(1);
    }
    Path file = Path.of(args[0]).toAbsolutePath().normalize();
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    try (FileInputStream in = new FileInputStream(file.toFile())) {
      byte[] buf = new byte[8192];
      int read;
      while ((read = in.read(buf)) > 0) {
        digest.update(buf, 0, read);
      }
    }
    StringBuilder hex = new StringBuilder();
    for (byte b : digest.digest()) {
      hex.append(String.format("%02x", b));
    }
    System.out.println(hex + "  " + file.getFileName());
  }
}
