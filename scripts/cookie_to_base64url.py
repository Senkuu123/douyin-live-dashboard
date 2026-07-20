import base64
import getpass


def to_base64url(value: str) -> str:
    """Encode a UTF-8 string as unpadded Base64URL."""
    return base64.urlsafe_b64encode(value.encode("utf-8")).decode("ascii").rstrip("=")


def main() -> None:
    cookie = getpass.getpass("粘贴Cookie（输入内容不会显示）：")
    if not cookie:
        raise SystemExit("未输入Cookie")

    print("\nBase64URL：")
    print(to_base64url(cookie))


if __name__ == "__main__":
    main()
