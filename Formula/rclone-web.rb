class RcloneWeb < Formula
  desc "Web frontend for rclone to manage and run jobs from your browser"
  homepage "https://github.com/yetanotherchris/rclone-web"
  version "1.0.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/yetanotherchris/rclone-web/releases/download/v1.0.0/rclone-web-darwin-arm64.tar.gz"
      sha256 "5790e20f6cac6d54cfaabfa4775314f7875295a119b871253f9420446f6bd989"
    else
      url "https://github.com/yetanotherchris/rclone-web/releases/download/v1.0.0/rclone-web-darwin-amd64.tar.gz"
      sha256 "8316696b7210a3213c50201635758340390608cc83183568385221742764926e"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/yetanotherchris/rclone-web/releases/download/v1.0.0/rclone-web-linux-arm64.tar.gz"
      sha256 "d0d7b2151eff3159884fa817779fef7cf40156065577fffbac1f9c0f6840322e"
    else
      url "https://github.com/yetanotherchris/rclone-web/releases/download/v1.0.0/rclone-web-linux-amd64.tar.gz"
      sha256 "aec46e938c946449f534eddfb8208247afc006c0e8eef635d9dbbd50bf46f650"
    end
  end

  def install
    bin.install "rclone-web-darwin-arm64" => "rclone-web" if OS.mac? && Hardware::CPU.arm?
    bin.install "rclone-web-darwin-amd64" => "rclone-web" if OS.mac? && !Hardware::CPU.arm?
    bin.install "rclone-web-linux-arm64" => "rclone-web" if OS.linux? && Hardware::CPU.arm?
    bin.install "rclone-web-linux-amd64" => "rclone-web" if OS.linux? && !Hardware::CPU.arm?
  end

  test do
    assert_match "rclone-web #{version}", shell_output("#{bin}/rclone-web --version")
  end
end